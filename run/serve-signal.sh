#!/usr/bin/env bash
cd "$(dirname "$0")"    # use script's location as working directory

set -a && . ../.env && node --enable-source-maps ../dist/signaling-server.js
