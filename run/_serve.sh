#!/usr/bin/env bash
cd "$(dirname "$0")"    # use script's location as working directory

export $(cat ../.env | grep -v '^#' | xargs)    # read and set variables from .env

node --enable-source-maps ../dist/${SCRIPT_PATH}
