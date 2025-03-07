var _ = require('lodash');

var SET_PAGE_CONSTANTS = 'pageConstants/SET_PAGE_CONSTANTS';

var ALLOWED_KEYS = new Set([
  'skinId',
  'showNextHint',
  'ttsShortInstructionsUrl',
  'ttsLongInstructionsUrl',
  'assetUrl',
  'canHaveFeedbackReviewState',
  'exampleSolutions',
  'isViewingAsInstructorInTraining',
  'channelId',
  'codeOwnersName',
  'hasDataMode',
  'hasDesignMode',
  'inStartBlocksMode',
  'isChallengeLevel',
  'isEmbedView',
  'isResponsive',
  'isIframeEmbed',
  'isReadOnlyWorkspace',
  'isCodeReviewing',
  'isViewingOwnProject',
  'hasBackgroundMusic',
  'displayNotStartedBanner',
  'displayOldVersionBanner',
  'isShareView',
  'isProjectLevel',
  'isSubmittable',
  'isSubmitted',
  'noInstructionsWhenCollapsed',
  'puzzleNumber',
  'lessonTotal',
  'showDebugButtons',
  'showDebugConsole',
  'showDebugWatch',
  'showDebugSlider',
  'debugConsoleDisabled',
  'showMakerToggle',
  'locale',
  'hasContainedLevels',
  'isDroplet',
  'isBlockly',
  'isBramble',
  'isMinecraft',
  'runButtonText',
  'visualizationHasPadding',
  'visualizationInWorkspace',
  'hideCoordinateOverlay',
  'hideSource',
  'hideRunButton',
  'hideResetButton',
  'playspacePhoneFrame',
  'noVisualization',
  'pinWorkspaceToBottom',
  'smallStaticAvatar',
  'failureAvatar',
  'aniGifURL',
  'inputOutputTable',
  'showAnimationMode',
  'startInAnimationTab',
  'allAnimationsSingleFrame',
  'nonResponsiveVisualizationColumnWidth',
  'is13Plus',
  'isSignedIn',
  'isEditingStartSources',
  'userId',
  'isK1',
  'textToSpeechEnabled',
  'documentationUrl',
  'appType',
  'nextLevelUrl',
  'isProjectTemplateLevel',
  'showProjectTemplateWorkspaceIcon',
  'serverLevelId',
  'serverProjectLevelId',
  'serverScriptId',
  'exportApp',
  'widgetMode',
  'librariesEnabled',
  'validationEnabled',
  'aiEnabled',
  'aiModelId',
  'aiModelName'
]);

const initialState = {
  assetUrl() {}
};

export default function reducer(state = initialState, action) {
  if (action.type === SET_PAGE_CONSTANTS) {
    Object.keys(action.props).forEach(function(key) {
      if (!ALLOWED_KEYS.has(key)) {
        throw new Error(
          `Property "${key}" may not be set using the ${action.type} action.`
        );
      }
      if (
        state[key] !== initialState[key] &&
        state[key] !== action.props[key]
      ) {
        throw new Error(`Can't change value of key "${key}".`);
      }
    });
    return _.assign({}, state, action.props);
  }

  return state;
}

/**
 * Push lots of page constants into the store.
 * Should be called during level init. Expectation is that these properties
 * never change once set.
 * Any properties omitted from the props argument are not set in the state.
 *
 * @param {!Object} props
 * @param {function} [props.assetUrl] - Helper function for retrieving
 *        assets for this particular level type.
 * @param {boolean} [props.isDesignModeHidden] - Whether the level restricts
 *        use of design mode.
 * @param {boolean} [props.isEmbedView] - Whether the level is being embedded
 *        in an iFrame.
 * @param {boolean} [props.isReadOnlyWorkspace] - Whether the loaded level
 *        should restrict editing the student code.
 * @param {boolean} [props.isShareView] - Whether we are displaying the level
 *        on a share page.
 * ...
 * @returns {{type: string, props: Object}}
 */
export function setPageConstants(props) {
  return {
    type: SET_PAGE_CONSTANTS,
    props: props
  };
}
