# 生成 Apex SSH 验证环境用的测试密钥对（Ed25519）
# 输出到 deploy/keys/id_ed25519（私钥，已加入 .gitignore）与 id_ed25519.pub（公钥，挂载进 ssh-key 容器）
# 用法：powershell -File deploy/生成密钥.ps1

$ErrorActionPreference = 'Stop'

$keysDir = Join-Path $PSScriptRoot 'keys'
$privateKey = Join-Path $keysDir 'id_ed25519'

if (Test-Path $privateKey) {
    Write-Host "密钥已存在：$privateKey（如需重建请先删除 keys 目录）"
    exit 0
}

New-Item -ItemType Directory -Force -Path $keysDir | Out-Null
# 无 passphrase，仅用于本地验证环境
ssh-keygen -t ed25519 -f $privateKey -N '""' -C 'apex-local-test'

Write-Host "已生成密钥对："
Write-Host "  私钥：$privateKey（请勿提交，已在 .gitignore 中忽略）"
Write-Host "  公钥：$privateKey.pub"
