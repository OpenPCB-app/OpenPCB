#!/bin/bash
# usage: reset-data.sh <A|B|C>  (stack must be stopped)
QA="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$QA/data/$1" && cp -cR "$QA/data/pristine" "$QA/data/$1" && echo "reset data $1"
