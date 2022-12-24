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
  const coverageBranch = core.getInput("coverage-branch");
  const generatedCoverageFilepath = core.getInput("generated-coverage-filepath");
  const allowedToFail = core.getBooleanInput("allowed-to-fail");

  core.info(`Begin coverage analysis... 2016`);

  const octokit = github.getOctokit(githubToken);

  let head = {};

  const file = JSON.parse(readFileSync(generatedCoverageFilepath));
  Object.keys(file).forEach(key => {
    head[key] = file[key];
  });

  const pct = average(
    Object.keys(head.total)
        .filter(t => typeof head.total[t].pct === 'number')
        .map((t) => head.total[t].pct),
    0
  );

  core.info(`pct: ${pct}`);

  const coverageBranchRef = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    branch: coverageBranch,
  });

  core.info(JSON.stringify(coverageBranchRef));

  if (!coverageBranchRef?.data?.name) {
    throw new Error(`please create branch: ${coverageBranch}`)
  }

  const headCoverage = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    path: `${context.payload.pull_request.head.sha}.json`,
    ref: coverageBranch
  })

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    path: `coverage/${context.payload.pull_request.head.sha}.json`,
    branch: coverageBranch,
    message: 'create / update branch coverage',
    committer: {
      name: 'PR Coverage Diff',
      email: 'pr-coverage-diff'
    },
    content: btoa(JSON.stringify(head)),
    sha: headCoverage?.data?.sha,
  });

  core.info('coverage uploaded for branch');

  let base = {};
  let diff = {};
  try {
    const {content: baseJson} = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      path: `coverage/${context.payload.pull_request.base.sha}.json`,
      ref: coverageBranch
    })
    core.info(`base: ${baseJson}`);
    base = JSON.parse(baseJson);

    diff = computeDiff(base, head, { allowedToFail });

    core.info(`diff: ${diff}`);

    const issue_number = context.payload.pull_request.number;
    core.info(`issue: ${issue_number}`);

    if (issue_number) {
      await deleteExistingComments(octokit, context.repo, issue_number);

      core.info("Add a comment with the diff coverage report");
      await addComment(octokit, context.repo, issue_number, diff.markdown);
    } else {
      core.info(diff.results);
    }
  } catch (e) {
    // can merge without a base coverage file
    core.info('base coverage file does not exist, merge to add it');
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
