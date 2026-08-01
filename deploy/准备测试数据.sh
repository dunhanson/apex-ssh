#!/bin/sh
# 在容器内生成 SFTP 验证数据集（对应实施计划的「SFTP 验证数据集」）
# 用法：sh deploy/准备测试数据.sh <容器名>，如：
#   sh deploy/准备测试数据.sh apex-ssh-pass
#   sh deploy/准备测试数据.sh apex-ssh-key

set -e

CONTAINER="${1:-apex-ssh-pass}"
BASE=/config/sftp-testdata

echo "在容器 $CONTAINER 内生成测试数据集：$BASE"

docker exec "$CONTAINER" sh -c "
set -e
BASE=$BASE
mkdir -p \"\$BASE\"

# 小文件（KB 级）
mkdir -p \"\$BASE/小文件\"
for i in 1 2 3; do
  head -c 2048 /dev/urandom | base64 > \"\$BASE/小文件/small-\$i.txt\"
done

# 中文件（10MB）
dd if=/dev/urandom of=\"\$BASE/medium-10MB.bin\" bs=1M count=10 2>/dev/null

# 大文件（500MB+，用于断点续传验证）
if [ ! -f \"\$BASE/large-500MB.bin\" ]; then
  dd if=/dev/urandom of=\"\$BASE/large-500MB.bin\" bs=1M count=500 2>/dev/null
fi

# 中文 / 空格文件名
echo '中文文件名测试' > \"\$BASE/中文 文件 名.txt\"
echo 'file with spaces' > \"\$BASE/file with spaces.txt\"

# 多层嵌套目录
mkdir -p \"\$BASE/嵌套/第一层/第二层/第三层\"
for d in 嵌套 嵌套/第一层 嵌套/第一层/第二层 嵌套/第一层/第二层/第三层; do
  echo \"level: \$d\" > \"\$BASE/\$d/readme.txt\"
done

# 无权限目录（验证错误提示）
mkdir -p \"\$BASE/no-access\"
chmod 000 \"\$BASE/no-access\"

chown -R abc:abc \"\$BASE\" 2>/dev/null || true
chmod 000 \"\$BASE/no-access\"

ls -la \"\$BASE\"
"

echo "完成。数据集位于容器 $CONTAINER 的 $BASE"
