/**
 * Invokes each app's own local ESLint binary directly with an explicit
 * --config path, so no `cd`/shell-quoting is needed and each app's distinct
 * plugin set (NestJS+Prettier vs Angular+Prettier) resolves unambiguously.
 * lint-staged always passes absolute file paths, which both work with here.
 */
function eslintFix(appDir, configFile) {
  return (absolutePaths) => {
    const files = absolutePaths.map((file) => `"${file}"`).join(' ');
    return [`${appDir}/node_modules/.bin/eslint --config ${appDir}/${configFile} --fix ${files}`];
  };
}

module.exports = {
  'backend/**/*.ts': eslintFix('backend', 'eslint.config.mjs'),
  'frontend/**/*.{ts,html}': eslintFix('frontend', 'eslint.config.js'),
};
