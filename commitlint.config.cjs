// Enforces IMPLEMENTATION_ROADMAP.md Section 2.4's Conventional Commits
// convention: exactly `<type>(<scope>): <description>`, restricted to the
// eight types that document names explicitly.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci'],
    ],
  },
};
