const {
  readFile,
  writeFile,
  copyFile,
  mkdir,
  mkdtemp,
} = require("fs/promises");
const { existsSync } = require("fs");
const path = require("path");
const core = require("@actions/core");
const github = require("@actions/github");

const { gitClone, gitUpdate } = require("./git");
const { isBranch, isMainBranch } = require("./branch");
const { getShieldURL, getJSONBadge } = require("./badge");
const { average } = require("./math");
const { computeDiff } = require("./diff");
const { addComment, deleteExistingComments } = require("./comment");

const { context } = github;

async function run() {
  const tmpPath = await mkdir(path.join(process.env.GITHUB_WORKSPACE, "tmp"), {
    recursive: true,
  });
  const WIKI_PATH = await mkdtemp(path.join(tmpPath, "coverage-diff-"));

  const githubToken = core.getInput("github-token");
  const coverageOutput = core.getInput("coverage-output-filepath");
  const generatedCoverageFilepath = core.getInput("generated-coverage-filepath");

  core.info(`Cloning wiki repositories... 201`);
  core.info(context.workspace);
  core.info(generatedCoverageFilepath);
  core.info(JSON.stringify(context));

  const octokit = github.getOctokit(githubToken);

  const globber = readdirGlob(context.workspace, {pattern: generatedCoverageFilepath});

  let globbing = true;
  let headJson = {};
  let globFile = {};

  while(globbing) {
    globber.on('match', async (match) => {
      globFile = JSON.parse(await readFile(match.relative, "utf8"));
      Object.keys(globFile).forEach(key => {
        headJson[key] = globFile[key];
      })
    });

    globber.on('error', err => {
      throw new Error('fatal error', err.message);
    });

    globber.on('end', (m) => {
      globbing = false;
    });
  }

  console.log(headJson)

  const pct = average(
    Object.keys(head.total).map((t) => head.total[t].pct),
    0
  );

  if (
    isBranch() &&
    (await isMainBranch(octokit, context.repo.owner, context.repo.repo))
  ) {
    core.info("Running on default branch");
    const BadgeEnabled = core.getBooleanInput("badge-enabled");
    const badgeFilename = core.getInput("badge-filename");

    core.info("Saving json-summary report into the repo wiki");
    await copyFile(coverageFilename, path.join(WIKI_PATH, baseSummaryFilename));

    if (BadgeEnabled) {
      core.info("Saving Badge into the repo wiki");

      const badgeThresholdGreen = core.getInput("badge-threshold-green");

      await writeFile(
        path.join(WIKI_PATH, badgeFilename),
        JSON.stringify(
          getJSONBadge(pct, badgeThresholdGreen, badgeThresholdOrange)
        )
      );
    }

    await gitUpdate(WIKI_PATH);

    if (BadgeEnabled) {
      const url = `https://raw.githubusercontent.com/wiki/${process.env.GITHUB_REPOSITORY}/${badgeFilename}`;
      core.info(`Badge JSON stored at ${url}`);
      core.info(`Badge URL: ${getShieldURL(url)}`);
    }
  } else {
    core.info("Running on pull request branch");
    if (!existsSync(path.join(WIKI_PATH, baseSummaryFilename))) {
      core.info("No base json-summary found");
      return;
    }

    const issue_number = context?.payload?.pull_request?.number;
    const allowedToFail = core.getBooleanInput("allowed-to-fail");
    const base = JSON.parse(
      await readFile(path.join(WIKI_PATH, baseSummaryFilename), "utf8")
    );

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
}

try {
  run();
} catch (error) {
  core.setFailed(error.message);
}
