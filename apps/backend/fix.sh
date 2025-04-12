#!/bin/bash

# 获取当前环境的conda路径
CONDA_PREFIX=$(conda info --base)/envs/ametrine

# 遍历并修复所有包路径
find $CONDA_PREFIX/bin -type f -exec sed -i "1s|^#!.*/root/miniconda3/envs/ametrine/bin/python|#!$CONDA_PREFIX/bin/python|" {} \;

# 提示修复完成
echo "✅ 所有包路径已修复完成！"

# 验证
which python
which pip
