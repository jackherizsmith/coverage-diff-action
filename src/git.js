const simpleGit = require("simple-git");

async function gitUpdate(wikiPath) {
  return await simpleGit(wikiPath)
    .addConfig("user.name", "Coverage Diff Action")
    .addConfig("user.email", "coverage-diff-action")
    .add("*")
    .commit("Update coverage badge")
    .push();
}

module.exports = {  gitUpdate };
