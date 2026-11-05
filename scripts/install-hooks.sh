#!/bin/sh
# 一键安装 doc-sync git hooks：git config core.hooksPath 指向仓库内 scripts/hooks
# 新账号 clone 后执行一次：sh scripts/install-hooks.sh
ROOT=$(git rev-parse --show-toplevel)
git config core.hooksPath scripts/hooks
echo "✅ doc-sync hooks 已安装（core.hooksPath = scripts/hooks）"
echo "   prepare-commit-msg：commit 时显示必同步文档清单"
echo "   commit-msg：改代码未带文档更新时拒绝提交（--no-verify 可绕过）"
