const { readFileSync } = require("fs");
const core = require("@actions/core");
const github = require("@actions/github");

const { average } = require("./math");
const { computeDiff } = require("./diff");
const { addComment, deleteExistingComments } = require("./comment");

const { context } = github;

async function run() {
  if (!context?.payload?.pull_request) {
    throw new Error('This action is only intended to run on pull requests.')
  }

  const githubToken = core.getInput("github-token");
  const coverageOutput = core.getInput("coverage-output-filepath");
  const generatedCoverageFilepath = core.getInput("generated-coverage-filepath");

  core.info(`Begin coverage analysis... 207`);

  const octokit = github.getOctokit(githubToken);

  let head = {};

  const file = JSON.parse(readFileSync(generatedCoverageFilepath));
  core.info(JSON.stringify(file));
  Object.keys(file).forEach(key => {
    head[key] = file[key];
  });

  core.info(`head: ${JSON.stringify(head)}`);

  const pct = average(
    Object.keys(head.total)
        .filter(t => typeof head.total[t].pct === 'number')
        .map((t) => head.total[t].pct),
    0
  );

  core.info(`pct: ${pct}`);

  const baseJson = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    path: coverageOutput,
    ref: context.payload.pull_request.base.ref
  })

  core.info(`base: ${baseJson}`);

  const issue_number = context.payload.pull_request.number;
  const allowedToFail = core.getBooleanInput("allowed-to-fail");
  const base = JSON.parse(baseJson);

  const diff = computeDiff(base, head, { allowedToFail });

  if (issue_number) {
    await deleteExistingComments(octokit, context.repo, issue_number);

    core.info("Add a comment with the diff coverage report");
    await addComment(octokit, context.repo, issue_number, diff.markdown);
  } else {
    core.info(diff.results);
  }

  if (!allowedToFail && diff.regression) {
    throw new Error("Total coverage is lower than the default branch");
  }
}

try {
  run();
} catch (error) {
  core.setFailed(error.message);
}
