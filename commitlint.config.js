/**
 * commitlint 配置：Conventional Commits，提交信息以中文为主。
 *
 * 规范说明见 `.cursorrules` 的「Git Commit Message 规范」。
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 允许的 type（小写）
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'perf',
        'docs',
        'test',
        'chore',
        'style',
        'ci',
        'build',
        'revert',
      ],
    ],
    'type-empty': [2, 'never'],
    'scope-empty': [0],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    // 中文没有大小写，英文主题也不强制大小写
    'subject-case': [0],
    // 主题不以英文句点结尾（中文句号不限制）
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [2, 'always', 100],
  },
}
