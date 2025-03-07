import $ from 'jquery';
import _ from 'lodash';
import LegacyDialog from '@cdo/apps/code-studio/LegacyDialog';
import {assert} from '../../util/reconfiguredChai';
import {
  getConfigRef,
  getProjectDatabase
} from '@cdo/apps/storage/firebaseUtils';
import Firebase from 'firebase';
import MockFirebase from '../../util/MockFirebase';
import {installCustomBlocks} from '@cdo/apps/block_utils';

var testCollectionUtils = require('./testCollectionUtils');

module.exports = function(testCollection, testData, dataItem, done) {
  const finished = _.once(() => done(/*ensure no args*/));

  // LegacyDialog is stubbed in the beforeEach step in levelTests.js
  LegacyDialog.prototype.show.callsFake(() => {
    if (!LegacyDialog.levelTestDontFinishOnShow) {
      finished();
    }
  });

  dataItem();
  var app = testCollection.app;

  // skin shouldn't matter for most cases
  var skinId = testCollection.skinId || 'farmer';

  var level = testCollectionUtils.getLevelFromCollection(
    testCollection,
    testData,
    dataItem
  );

  // Override speed
  if (!level.scale) {
    level.scale = {};
  }
  level.scale.stepSpeed = 1;
  level.sliderSpeed = 1;

  // studio tests depend on timing
  if (app === 'studio') {
    level.scale.stepSpeed = 33;
  }

  if (testData.lastAttempt) {
    level.lastAttempt = testData.lastAttempt;
  }

  // Override start blocks to load the solution;
  level.startBlocks = testData.xml;

  level.startHtml = testData.startHtml;
  level.levelHtml = testData.levelHtml;

  level.hideViewDataButton = testData.hideViewDataButton;
  var validationCallCount = 0;

  // Validate successful solution.
  var validateResult = async function(report) {
    try {
      assert(testData.expected, 'Have expectations');
      var expected;
      if (Array.isArray(testData.expected)) {
        expected = testData.expected[validationCallCount++];
      } else {
        expected = testData.expected;
      }
      assert(Object.keys(expected).length > 0, 'No expected keys specified');
      Object.keys(expected).forEach(function(key) {
        if (report[key] !== expected[key]) {
          var failureMsg = `Failure for key: ${key}. Expected: ${
            expected[key]
          }. Got: ${report[key]}\n`;
          assert(false, failureMsg);
        }
      });

      // define a customValidator to run/validate arbitrary code at the point when
      // StudioApp.report gets called. Allows us to access some things that
      // aren't on the options object passed into report
      if (testData.customValidator) {
        // Wait some amount of time for long-running code to complete. (E.g. k1_6.js).
        // Increase the timer below if things start failing here. It's important that
        // we ONLY do this for studio tests, which depend on timing.
        if (app === 'studio') {
          await new Promise(resolve => {
            setTimeout(() => {
              assert(
                testData.customValidator(assert),
                'Custom validator failed'
              );
              resolve();
            }, 2500);
          });
        } else {
          // For non-studio tests, run without waiting.
          assert(testData.customValidator(assert), 'Custom validator failed');
        }
      }

      // Notify the app that the report operation is complete
      // (important to do this asynchronously to simulate a service call or else
      //  we will have problems with the animating_ / waitingForReport_ states
      //  in the maze state machine)
      if (report.onComplete) {
        setTimeout(report.onComplete, 0);
      }
    } catch (e) {
      done(e);
    }
  };

  runLevel(app, skinId, level, validateResult, finished, testData);
};

const appLoaders = {
  applab: require('@cdo/apps/sites/studio/pages/init/loadApplab'),
  calc: require('@cdo/apps/sites/studio/pages/init/loadCalc'),
  craft: require('@cdo/apps/sites/studio/pages/init/loadCraft'),
  eval: require('@cdo/apps/sites/studio/pages/init/loadEval'),
  gamelab: require('../../util/gamelab/loadTestableGamelab'),
  maze: require('@cdo/apps/sites/studio/pages/init/loadMaze'),
  studio: require('@cdo/apps/sites/studio/pages/init/loadStudio'),
  turtle: require('@cdo/apps/sites/studio/pages/init/loadArtist')
};
function runLevel(app, skinId, level, onAttempt, finished, testData) {
  var loadApp = appLoaders[app];

  var studioApp = require('@cdo/apps/StudioApp').singleton;

  if (testData.libraries) {
    studioApp().libraries = testData.libraries;
  }

  if (level.editCode) {
    assert(window.droplet, 'droplet is in global');
  }
  setAppSpecificGlobals(app);

  const unexpectedExecutionErrorMsg =
    'Unexpected execution error. ' +
    'Define onExecutionError() in your level test case to handle this.';

  const options = {
    app,
    skinId: skinId,
    level: level,
    baseUrl: '/base/build/package/',
    channel: 'applab-channel-id',
    assetPathPrefix: testData.assetPathPrefix,
    containerId: 'app',
    embed: testData.embed,
    firebaseName: 'test-firebase-name',
    firebaseSharedAuthToken: 'test-firebase-shared-auth-token',
    firebaseAuthToken: 'test-firebase-auth-token',
    isSignedIn: true,
    onFeedback: finished,
    onExecutionError: testData.onExecutionError
      ? testData.onExecutionError
      : () => {
          throw unexpectedExecutionErrorMsg;
        },
    onInitialize: function() {
      // we have a race condition for loading our editor. give it another 500ms
      // to load if it hasnt already
      var timeout = 0;
      if (level.editCode && !studioApp().editor) {
        timeout = 500;
      }

      if (app === 'applab') {
        // Karma must be configured to use MockFirebase in our webpack config.
        assert(
          Firebase === MockFirebase,
          'Expected to be using apps/test/util/MockFirebase in level tests.'
        );

        getProjectDatabase().autoFlush();
        getConfigRef().autoFlush();
        getConfigRef().set({
          limits: {
            '15': 5,
            '60': 10
          },
          maxRecordSize: 100,
          maxPropertySize: 100,
          maxTableRows: 20,
          maxTableCount: 10
        });
        timeout = 500;

        getProjectDatabase().set(null);
      }

      setTimeout(function() {
        assert(window.droplet, 'droplet is in global');

        // Click the run button!
        if (testData.runBeforeClick) {
          testData.runBeforeClick(assert);
        }

        $('#runButton').click();
      }, timeout);
      // waitLong();
    },
    onAttempt: onAttempt
  };

  loadApp(options);

  if (level.sharedBlocks) {
    installCustomBlocks({
      blockly: Blockly,
      blockDefinitions: level.sharedBlocks,
      customInputTypes: options.blocksModule.customInputTypes
    });
  }
}

function setAppSpecificGlobals(app) {
  // app specific hacks
  switch (app.toLowerCase()) {
    case 'calc':
      global.Calc = window.Calc;
      break;
    case 'eval':
      global.Eval = window.Eval;
      break;
  }
}
