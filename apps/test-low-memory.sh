#!/bin/bash
set -e

# 'npm test' normally does all three of these things.
# We break them up here so they each run in isolation.
GRUNT_CMD="node --max_old_space_size=4096 `npm bin`/grunt"

if [ -n "$CIRCLECI" ]; then
  NPROC=4
  mkdir -p log
  echo <<STR
###################################################################
#                                                                 #
#   See 'apps-test-log' under the artifacts tab for test output   #
#                                                                 #
###################################################################
STR
  CODECOV=/tmp/codecov.sh
  curl -s https://codecov.io/bash > ${CODECOV}
  chmod +x ${CODECOV}
  LOG=">"
else
  # For non-Circle runs, stub-out codecov and logging to files.
  NPROC=$(nproc)
  CODECOV=: # stub
  LOG='&& :' # stub
fi

$GRUNT_CMD preconcat

export SHELL=/bin/bash

if command -v parallel 2>/dev/null; then
  PARALLEL="parallel --halt 2 -j ${NPROC} --joblog - :::"
else
  PARALLEL="xargs -P${NPROC} -I{} ${SHELL} -c {}"
fi

${PARALLEL} <<SCRIPT
npm run lint
(PORT=9876 ${GRUNT_CMD} unitTest && ${CODECOV} -cF unit) ${LOG} log/unitTest.log
(PORT=9877 $GRUNT_CMD storybookTest && ${CODECOV} -cF storybook) ${LOG} log/storybookTest.log
(PORT=9878 $GRUNT_CMD scratchTest && ${CODECOV} -cF scratch) ${LOG} log/scratchTest.log
(PORT=9879 LEVEL_TYPE='turtle' $GRUNT_CMD karma:integration && \
  ${CODECOV} -cF integration) ${LOG} log/turtleTest.log
(PORT=9880 LEVEL_TYPE='maze\|bounce\|calc\|eval\|flappy\|studio' $GRUNT_CMD karma:integration && \
  ${CODECOV} -cF integration) ${LOG} log/integrationTest.log
(PORT=9881 LEVEL_TYPE='applab\|gamelab' $GRUNT_CMD karma:integration && \
  ${CODECOV} -cF integration) ${LOG} log/appLabgameLabTest.log
(PORT=9882 LEVEL_TYPE='craft' $GRUNT_CMD karma:integration && \
  ${CODECOV} -cF integration) ${LOG} log/craftTest.log
SCRIPT
