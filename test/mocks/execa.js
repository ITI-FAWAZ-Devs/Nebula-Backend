const execa = (file, args, options) =>
  Promise.resolve({ stdout: '', stderr: '', exitCode: 0, command: file });
const execaSync = (file, args, options) => ({ stdout: '', stderr: '', exitCode: 0, command: file });
const $ = (strings, ...values) => execa('', []);
module.exports = { execa, execaSync, $, default: { execa, execaSync, $ } };
