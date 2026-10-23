#!/bin/sh
# A mounted volume arrives owned by root. Fix ownership of the data directory, then run the service as the unprivileged user.
set -eu
mkdir -p "${ACC_DATA_DIR:-/data}"
chown -R acc:acc "${ACC_DATA_DIR:-/data}"
chmod 700 "${ACC_DATA_DIR:-/data}"
exec runuser -u acc -- node server/acc_server.js
