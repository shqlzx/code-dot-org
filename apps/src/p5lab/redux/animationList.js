/*global dashboard*/
/**
 * @file Redux module for new format for tracking project animations.
 */
import _ from 'lodash';
import {combineReducers} from 'redux';
import {createUuid} from '@cdo/apps/utils';
import {
  fetchURLAsBlob,
  blobToDataURI,
  dataURIToSourceSize
} from '@cdo/apps/imageUtils';
import {animations as animationsApi} from '@cdo/apps/clientApi';
import * as assetPrefix from '@cdo/apps/assetManagement/assetPrefix';
import {selectAnimation, selectBackground} from './animationTab';
import {reportError} from './errorDialogStack';
import {throwIfSerializedAnimationListIsInvalid} from '../shapes';
import {
  projectChanged,
  isOwner,
  getCurrentId
} from '@cdo/apps/code-studio/initApp/project';
import firehoseClient from '@cdo/apps/lib/util/firehose';
import trackEvent from '@cdo/apps/util/trackEvent';
import {P5LabInterfaceMode} from '../constants';

// TODO: Overwrite version ID within session
// TODO: Load exact version ID on project load
// TODO: Warn about duplicate-named animations.

// Args: {SerializedAnimationList} animationList
export const SET_INITIAL_ANIMATION_LIST =
  'AnimationList/SET_INITIAL_ANIMATION_LIST';
// Args: {AnimationKey} key, {AnimationProps} props
export const ADD_ANIMATION = 'AnimationList/ADD_ANIMATION';
// Args: {number} index, {AnimationKey} key, {AnimationProps} props
export const ADD_ANIMATION_AT = 'AnimationList/ADD_ANIMATION_AT';
// Args: {AnimationKey} key, {AnimationProps} props
export const EDIT_ANIMATION = 'AnimationList/EDIT_ANIMATION';
// Args: {AnimationKey} key, {string} name
const SET_ANIMATION_NAME = 'AnimationList/SET_ANIMATION_NAME';
// Args: {AnimationKey} key, {bool} looping
const SET_ANIMATION_LOOPING = 'AnimationList/SET_ANIMATION_LOOPING';
// Args: {AnimationKey} key, {number} frameDelay
const SET_ANIMATION_FRAME_DELAY = 'AnimationList/SET_ANIMATION_FRAME_DELAY';
// Args: {AnimationKey} key
const DELETE_ANIMATION = 'AnimationList/DELETE_ANIMATION';
// Args: {AnimationKey} key
export const START_LOADING_FROM_SOURCE =
  'AnimationList/START_LOADING_FROM_SOURCE';
// Args: {AnimationKey} key, {Blob} blob, {String} dataURI. Version?
export const DONE_LOADING_FROM_SOURCE =
  'AnimationList/DONE_LOADING_FROM_SOURCE';
// Args: {AnimationKey} key, {string} version
const ON_ANIMATION_SAVED = 'AnimationList/ON_ANIMATION_SAVED';
// Args: {AnimationKey} key, {!SerializedAnimation} props
const SET_PENDING_FRAMES = 'AnimationList/SET_PENDING_FRAMES';
// Args: none
export const START_LOADING_PENDING_FRAMES_FROM_SOURCE =
  'AnimationList/START_LOADING_PENDING_FRAMES_FROM_SOURCE';
// Args: {AnimationKey} key, {Blob} blob, {String} dataURI. Version?
export const DONE_LOADING_PENDING_FRAMES_FROM_SOURCE =
  'AnimationList/DONE_LOADING_PENDING_FRAMES_FROM_SOURCE';
// Args: none
export const REMOVE_PENDING_FRAMES = 'AnimationList/REMOVE_PENDING_FRAMES';

export default combineReducers({
  orderedKeys,
  propsByKey,
  pendingFrames
});

const BACKGROUNDS_CATEGORY = 'backgrounds';

/** pendingFrames is used for temporarily storing additional
 * frames before they get added to the animation in Piskel.
 * pendingFrames gets added to animation in PiskelEditor.jsx
 */
function pendingFrames(state, action) {
  state = state || {};
  switch (action.type) {
    case SET_PENDING_FRAMES:
      return {
        key: action.key,
        props: action.props
      };

    case REMOVE_PENDING_FRAMES:
      return {};

    case START_LOADING_PENDING_FRAMES_FROM_SOURCE:
      return Object.assign({}, state, {
        loadedFromSource: false
      });

    case DONE_LOADING_PENDING_FRAMES_FROM_SOURCE:
      return Object.assign({}, state, {
        loadedFromSource: true,
        saved: true,
        loadedProps: action.loadedProps
      });

    default:
      return state;
  }
}

function orderedKeys(state, action) {
  state = state || [];
  switch (action.type) {
    case SET_INITIAL_ANIMATION_LIST:
      return action.animationList.orderedKeys;

    case ADD_ANIMATION:
      return [].concat(state.slice(0), action.key);

    case ADD_ANIMATION_AT:
      return [].concat(
        state.slice(0, action.index),
        action.key,
        state.slice(action.index)
      );

    case DELETE_ANIMATION:
      return state.filter(key => key !== action.key);

    default:
      return state;
  }
}

function propsByKey(state, action) {
  state = state || {};
  var newState;
  switch (action.type) {
    case SET_INITIAL_ANIMATION_LIST:
      return action.animationList.propsByKey;

    case ADD_ANIMATION:
    case ADD_ANIMATION_AT:
    case EDIT_ANIMATION:
    case SET_ANIMATION_NAME:
    case SET_ANIMATION_LOOPING:
    case SET_ANIMATION_FRAME_DELAY:
    case START_LOADING_FROM_SOURCE:
    case DONE_LOADING_FROM_SOURCE:
    case ON_ANIMATION_SAVED:
      return Object.assign({}, state, {
        [action.key]: animationPropsReducer(state[action.key], action)
      });

    case DELETE_ANIMATION:
      newState = Object.assign({}, state);
      delete newState[action.key];
      return newState;

    default:
      return state;
  }
}

/**
 * Reducer for a single animation props item.
 */
function animationPropsReducer(state, action) {
  state = state || {};
  switch (action.type) {
    case ADD_ANIMATION:
    case ADD_ANIMATION_AT:
      return action.props;

    case EDIT_ANIMATION:
      return Object.assign({}, state, action.props, {
        sourceUrl: null, // Once edited this animation is custom.
        saved: false // Dirty, so it'll get saved soon.
      });

    case SET_ANIMATION_NAME:
      return Object.assign({}, state, {
        name: action.name
      });

    case SET_ANIMATION_FRAME_DELAY:
      return Object.assign({}, state, {
        frameDelay: action.frameDelay
      });

    case SET_ANIMATION_LOOPING:
      return Object.assign({}, state, {
        looping: action.looping
      });

    case START_LOADING_FROM_SOURCE:
      return Object.assign({}, state, {
        loadedFromSource: false
      });

    case DONE_LOADING_FROM_SOURCE:
      return Object.assign({}, state, {
        loadedFromSource: true,
        saved: true,
        blob: action.blob,
        dataURI: action.dataURI,
        sourceSize: action.sourceSize
      });

    case ON_ANIMATION_SAVED:
      return Object.assign({}, state, {
        saved: true,
        version: action.version
      });

    default:
      return state;
  }
}

/**
 * Given a name and animationList, determine if the name is unique
 * @param {string} name
 * @param {Object} animationList - object of {AnimationKey} to {AnimationProps}
 */
export function isNameUnique(name, animationListProps) {
  for (let animation in animationListProps) {
    if (animationListProps[animation].name === name) {
      return false;
    }
  }
  return true;
}

/**
 * Given a baseName and a animationList, provide a unique name
 * @param {string} baseName - the original name for the animation (without numbers)
 * @param {Object} animationList - object of {AnimationKey} to {AnimationProps}
 */
function generateAnimationName(baseName, animationList) {
  let unavailableNumbers = [];
  // Match names with the form baseName_#
  for (let animation in animationList) {
    let animationName = animationList[animation].name;
    if (
      animationName &&
      animationName.substring(0, baseName.length) === baseName
    ) {
      animationName = animationName.replace(baseName, '');
      if (animationName[0] === '_') {
        const brokenUpString = animationName.split('_');
        // TODO: Address the fragility here if animationName includes multiple underscores.
        const number = parseInt(brokenUpString.pop());
        unavailableNumbers.push(number);
      }
    }
  }
  unavailableNumbers.sort((a, b) => a - b);
  let availableNumber = 1;
  for (let i = 0; i < unavailableNumbers.length; i++) {
    if (availableNumber === unavailableNumbers[i]) {
      availableNumber++;
    } else {
      break;
    }
  }
  return baseName + '_' + availableNumber.toString();
}

/**
 * @param {!SerializedAnimationList} serializedAnimationList
 * @param {object} animationsForV3Migration - optional - animations passed to replace /v3/ sprites
 * @returns {function()}
 */
export function setInitialAnimationList(
  serializedAnimationList,
  animationsForV3Migration,
  isSpriteLab
) {
  // Set default empty animation list if none was provided
  if (!serializedAnimationList) {
    serializedAnimationList = {orderedKeys: [], propsByKey: {}};
  }

  // TODO (from 2015): Tear out this migration when it hasn't been used for at least 3 consecutive non-summer months.
  if (Array.isArray(serializedAnimationList)) {
    trackEvent('Research', 'RanMigration', '2015-animation-migration');
    // We got old animation data that needs to be migrated.
    serializedAnimationList = {
      orderedKeys: serializedAnimationList.map(a => a.key),
      propsByKey: serializedAnimationList.reduce((memo, next) => {
        memo[next.key] = next;
        return memo;
      }, {})
    };
  }

  // TODO (from 2020): Tear out this migration when it hasn't been used for at least 3 consecutive non-summer months.
  // Migrate to v1 animation api for default animations in SpriteLab
  if (isSpriteLab && animationsForV3Migration) {
    serializedAnimationList.orderedKeys.forEach(loadedKey => {
      let animation = serializedAnimationList.propsByKey[loadedKey];
      if (
        !animation.sourceUrl ||
        animation.sourceUrl.includes(dashboard.project.getCurrentId())
      ) {
        // The animation was created by the project owner. Skip.
        return;
      }

      if (animation.sourceUrl.includes('/v3/')) {
        // We want to replace this sprite with the /v1/ sprite
        let details = `name=${animation.name};key=${loadedKey}`;
        if (animationsForV3Migration.propsByKey[loadedKey]) {
          // The key is the same in the main.json and in default sprites. Do a simple replacement.
          serializedAnimationList.propsByKey[loadedKey] =
            animationsForV3Migration.propsByKey[loadedKey];
          trackEvent('Research', 'ReplacedSpriteByKey', details);
        } else {
          // We were unable to find a replacement for the /v3/ sprite
          trackEvent('Research', 'CouldNotReplaceSprite', details);
        }
      }
    });
  }

  // Convert frameRates to frameDelays.
  for (let key in serializedAnimationList.propsByKey) {
    let animation = serializedAnimationList.propsByKey[key];
    if (!animation.frameDelay) {
      if (
        typeof animation.frameRate === 'number' &&
        !isNaN(animation.frameRate) &&
        animation.frameRate !== 0
      ) {
        animation.frameDelay = Math.round(30 / animation.frameRate);
      } else {
        animation.frameDelay = 2;
      }
    }
    if (animation.looping === undefined) {
      animation.looping = true;
    }
  }

  // If animations have the same name, rename one.
  const numberAnimations = serializedAnimationList.orderedKeys.length;
  for (let i = 0; i < numberAnimations; i++) {
    const key = serializedAnimationList.orderedKeys[i];
    const name = serializedAnimationList.propsByKey[key].name;
    for (let j = i + 1; j < numberAnimations; j++) {
      const otherKey = serializedAnimationList.orderedKeys[j];
      if (name === serializedAnimationList.propsByKey[otherKey].name) {
        serializedAnimationList.propsByKey[
          otherKey
        ].name = generateAnimationName(
          name,
          serializedAnimationList.propsByKey
        );
      }
    }
  }

  try {
    throwIfSerializedAnimationListIsInvalid(serializedAnimationList);
  } catch (err) {
    console.error('Unable to load animations:', err);
    return;
  }

  return dispatch => {
    dispatch({
      type: SET_INITIAL_ANIMATION_LIST,
      animationList: serializedAnimationList
    });
    // Sprite Lab supports both costumes and backgrounds.
    // We need to select a default animation for each tab.
    if (isSpriteLab) {
      const costumeKeys = getOrderedKeysWithoutBackgrounds(
        serializedAnimationList
      );
      dispatch(selectAnimation(costumeKeys[0] || ''));
      const backgroundKeys = getOrderedKeysOnlyBackgrounds(
        serializedAnimationList
      );
      dispatch(selectBackground(backgroundKeys[0] || ''));
    } else {
      const animationKeys = serializedAnimationList.orderedKeys;
      dispatch(selectAnimation(animationKeys[0] || ''));
    }
    serializedAnimationList.orderedKeys.forEach(key => {
      dispatch(loadAnimationFromSource(key));
    });
  };
}

const getOrderedKeysWithoutBackgrounds = serializedAnimationList => {
  return serializedAnimationList.orderedKeys.filter(animKey => {
    const animProps = serializedAnimationList.propsByKey[animKey];
    return (
      !animProps.categories ||
      !animProps.categories.includes(BACKGROUNDS_CATEGORY)
    );
  });
};

const getOrderedKeysOnlyBackgrounds = serializedAnimationList => {
  return serializedAnimationList.orderedKeys.filter(animKey => {
    const animProps = serializedAnimationList.propsByKey[animKey];
    return (
      animProps.categories &&
      animProps.categories.includes(BACKGROUNDS_CATEGORY)
    );
  });
};

export function addBlankAnimation(interfaceMode) {
  // To avoid special cases and saving tons of blank animations to our server,
  // we're actually adding a secret blank library animation any time the user
  // picks "Draw my own."  As soon as the user makes any changes to the
  // animation it gets saved as a custom animation in their own project, just
  // like we do with other library animations.
  const isBackground = interfaceMode === P5LabInterfaceMode.BACKGROUND;
  const blankAnimation = {
    name: 'animation',
    sourceUrl:
      '/api/v1/animation-library/mUlvnlbeZ5GHYr_Lb4NIuMwPs7kGxHWz/category_backgrounds/blank.png',
    frameSize: {x: 100, y: 100},
    frameCount: 1,
    looping: true,
    frameDelay: 4,
    version: 'mUlvnlbeZ5GHYr_Lb4NIuMwPs7kGxHWz'
  };
  const blankBackground = {
    name: 'blank_background',
    sourceUrl:
      '/api/v1/animation-library/level_animations/.31YUNsUQNxLZeGkrQper8CLl_jyNb71/blank.png',
    frameSize: {x: 400, y: 400},
    frameCount: 1,
    looping: true,
    frameDelay: 2,
    categories: [BACKGROUNDS_CATEGORY],
    version: '.31YUNsUQNxLZeGkrQper8CLl_jyNb71'
  };
  return addLibraryAnimation(
    isBackground ? blankBackground : blankAnimation,
    isBackground
  );
}

/**
 * Add a blank frame to pending frames for the selected animation.
 * @returns {function}
 */
export function appendBlankFrame() {
  return (dispatch, getState) => {
    // Multiframe animations are only supported in Game Lab,
    // so we don't need to worry about backgrounds (which are only in Sprite Lab)
    const currentAnimationKey = getState().animationTab.currentAnimations[
      P5LabInterfaceMode.ANIMATION
    ];
    dispatch(setPendingFramesAction(currentAnimationKey, {blankFrame: true}));
    projectChanged();
  };
}

/**
 * Add an animation to the project (at the end of the list, unless a Sprite Lab project).
 * @param {!AnimationKey} key
 * @param {!SerializedAnimation} props
 */
export function addAnimation(key, props) {
  // TODO: Validate that key is not already in use?
  // TODO: Validate props format?
  return (dispatch, getState) => {
    const isSpriteLab =
      getState().pageConstants && getState().pageConstants.isBlockly;
    // Unlike Game Lab, Sprite Lab projects start with animations.
    // We add new animations to the top of the list to make them more discoverable.
    const index = isSpriteLab ? 0 : null;
    dispatch(addAnimationAction(key, {...props, looping: true}, index));
    const isBackground = props.categories?.includes(BACKGROUNDS_CATEGORY);
    const selector =
      isSpriteLab && isBackground ? selectBackground : selectAnimation;
    dispatch(
      loadAnimationFromSource(key, () => {
        dispatch(selector(key));
      })
    );
    let name = generateAnimationName(
      props.name,
      getState().animationList.propsByKey
    );
    dispatch(setAnimationName(key, name));
    projectChanged();
  };
}

/**
 * Append an animation to the project (at the end of the list of frames).
 * @param {!SerializedAnimation} props
 * @returns {function}
 */
export function appendCustomFrames(props) {
  return (dispatch, getState) => {
    // Multiframe animations are only supported in Game Lab,
    // so we don't need to worry about backgrounds (Sprite Lab only)
    const currentAnimationKey = getState().animationTab.currentAnimations[
      P5LabInterfaceMode.ANIMATION
    ];
    dispatch(setPendingFramesAction(currentAnimationKey, props));
    dispatch(loadPendingFramesFromSource(currentAnimationKey, props));
    projectChanged();
  };
}

/**
 * Add a library animation to the project (at the end of the list, unless a Sprite Lab project).
 * @param {!SerializedAnimation} props
 */
export function addLibraryAnimation(props, isSpriteLab) {
  return (dispatch, getState) => {
    const key = createUuid();
    if (getState().pageConstants && getState().pageConstants.isBlockly) {
      // Unlike Game Lab, Sprite Lab projects start with animations.
      // We add new animations to the top of the list to make them more discoverable.
      dispatch(addAnimationAction(key, props, 0));
    } else {
      dispatch(addAnimationAction(key, props));
    }
    const isSpriteLabBackground =
      props.categories?.includes(BACKGROUNDS_CATEGORY) && isSpriteLab;
    const selector = isSpriteLabBackground ? selectBackground : selectAnimation;
    dispatch(
      loadAnimationFromSource(key, () => {
        dispatch(selector(key));
      })
    );

    let name = generateAnimationName(
      props.name,
      getState().animationList.propsByKey
    );
    dispatch(setAnimationName(key, name));
    projectChanged();
  };
}

/**
 * Add a library animation as additional frames to the current animation
 * by adding them to pendingFrames.
 * @param {!SerializedAnimation} props
 * @returns {function}
 */
export function appendLibraryFrames(props) {
  return (dispatch, getState) => {
    // Multiframe animations are only supported in Game Lab,
    // so we don't need to worry about backgrounds (Sprite Lab only)
    const currentAnimationKey = getState().animationTab.currentAnimations[
      P5LabInterfaceMode.ANIMATION
    ];
    dispatch(setPendingFramesAction(currentAnimationKey, props));
    dispatch(loadPendingFramesFromSource(currentAnimationKey, props));
    projectChanged();
  };
}

/**
 * Clone the requested animation, putting the new one directly after the original
 * in the project animation list.
 * @param {!AnimationKey} key
 * @returns {Function}
 */
export function cloneAnimation(key, type = P5LabInterfaceMode.ANIMATION) {
  return (dispatch, getState) => {
    const animationList = getState().animationList;
    // Track down the source animation and its index in the collection
    const sourceIndex = animationList.orderedKeys.indexOf(key);
    if (sourceIndex < 0) {
      throw new Error(`Animation ${key} not found`);
    }

    const sourceAnimation = animationList.propsByKey[key];
    const newAnimationKey = createUuid();
    dispatch({
      type: ADD_ANIMATION_AT,
      index: sourceIndex + 1,
      key: newAnimationKey,
      props: Object.assign({}, sourceAnimation, {
        name: generateAnimationName(
          sourceAnimation.name + '_copy',
          animationList.propsByKey
        ),
        version: sourceAnimation.version,
        saved: false
      })
    });
    const selector =
      type === P5LabInterfaceMode.BACKGROUND
        ? selectBackground
        : selectAnimation;
    dispatch(selector(newAnimationKey));
    projectChanged();
  };
}

/**
 * Set the display name of the specified animation.
 * @param {string} key
 * @param {string} name
 * @returns {{type: string, key: string, name: string}}
 */
export function setAnimationName(key, name) {
  return dispatch => {
    dispatch({
      type: SET_ANIMATION_NAME,
      key,
      name
    });
    projectChanged();
  };
}

/**
 * Set the frameDelay of the specified animation.
 * @param {string} key
 * @param {number} frameDelay
 * @returns {{type: string, key: string, frameDelay: number}}
 */
export function setAnimationFrameDelay(key, frameDelay) {
  return dispatch => {
    dispatch({
      type: SET_ANIMATION_FRAME_DELAY,
      key,
      frameDelay
    });
    projectChanged();
  };
}

/**
 * Set the looping value of the specified animation.
 * @param {string} key
 * @param {bool} looping
 * @returns {{type: string, key: string, looping: bool}}
 */
export function setAnimationLooping(key, looping) {
  return dispatch => {
    dispatch({
      type: SET_ANIMATION_LOOPING,
      key,
      looping
    });
    projectChanged();
  };
}

/**
 * Modifies the animation props, capturing changes to its spritesheet.
 * @param {!AnimationKey} key
 * @param {object} props - needs a more detailed shape
 */
export function editAnimation(key, props) {
  return dispatch => {
    dispatch({
      type: EDIT_ANIMATION,
      key,
      props
    });
    projectChanged();
  };
}

/**
 * Delete the specified animation from the project.
 * @param {!AnimationKey} key
 * @returns {function}
 */
export function deleteAnimation(
  key,
  isSpriteLab = false,
  type = P5LabInterfaceMode.ANIMATION
) {
  return (dispatch, getState) => {
    const animationList = getState().animationList;
    let orderedKeys = animationList.orderedKeys;
    // If we're in spritelab, we need to make sure we don't set the selected animation to a background
    if (isSpriteLab) {
      switch (type) {
        case P5LabInterfaceMode.ANIMATION:
          orderedKeys = getOrderedKeysWithoutBackgrounds(animationList);
          break;
        case P5LabInterfaceMode.BACKGROUND:
          orderedKeys = getOrderedKeysOnlyBackgrounds(animationList);
          break;
      }
    }

    const currentSelectionIndex = orderedKeys.indexOf(key);
    let keyToSelect =
      currentSelectionIndex === 0 ? 1 : currentSelectionIndex - 1;
    const selector =
      type === P5LabInterfaceMode.BACKGROUND
        ? selectBackground
        : selectAnimation;
    dispatch(selector(orderedKeys[keyToSelect] || ''));

    dispatch({type: DELETE_ANIMATION, key});
    projectChanged();
    animationsApi.ajax('DELETE', key + '.png', () => {}, function error(xhr) {
      dispatch(
        reportError(
          `Error deleting object ${key}: ${xhr.status} ${xhr.statusText}`
        )
      );
    });
  };
}

/**
 * Load the indicated animation (which must already have an entry in the project
 * animation list) from its source, whether that is S3 or the animation library.
 * @param {!AnimationKey} key
 * @param {function} [callback]
 */
function loadAnimationFromSource(key, callback) {
  callback = callback || function() {};
  return (dispatch, getState) => {
    const state = getState();
    const sourceUrl = animationSourceUrl(
      key,
      state.animationList.propsByKey[key],
      state.pageConstants && state.pageConstants.channelId
    );
    dispatch({
      type: START_LOADING_FROM_SOURCE,
      key: key
    });
    fetchURLAsBlob(sourceUrl, (err, blob) => {
      if (err) {
        console.log('Failed to load animation ' + key, err);
        // Brute-force recovery step: Remove the animation from our redux state;
        // it looks like it's already gone from the server.

        // Log data about when this scenario occurs
        firehoseClient.putRecord(
          {
            study: 'animation_no_load',
            study_group: 'animation_no_load_v4',
            event: isOwner()
              ? 'animation_not_loaded_owner'
              : 'animation_not_loaded_viewer',
            project_id: getCurrentId(),
            data_json: JSON.stringify({
              sourceUrl: sourceUrl,
              mainJsonSourceUrl: state.animationList.propsByKey[key].sourceUrl,
              version: state.animationList.propsByKey[key].version,
              animationName: state.animationList.propsByKey[key].name,
              error: err.message
            })
          },
          {includeUserId: true}
        );

        if (isOwner()) {
          // Display error dialog
          dispatch(
            reportError(
              `Sorry, we couldn't load animation "${
                state.animationList.propsByKey[key].name
              }".`,
              'anim_load',
              key
            )
          );
        }

        return;
      }

      blobToDataURI(blob, dataURI => {
        dataURIToSourceSize(dataURI).then(sourceSize => {
          dispatch({
            type: DONE_LOADING_FROM_SOURCE,
            key,
            blob,
            dataURI,
            sourceSize
          });
          callback();
        });
      });
    });
  };
}

/**
 * Action creator for adding an animation.
 * @param {!AnimationKey} key
 * @param {SerializedAnimation} props
 * @param {number} [index]
 * @returns {{type: string, key: AnimationKey, props: SerializedAnimation}}
 */
export function addAnimationAction(key, props, index) {
  // Spritelab projects add animation at the beginning of animation list
  if (index === 0) {
    return {
      type: ADD_ANIMATION_AT,
      key,
      props,
      index
    };
  }
  return {
    type: ADD_ANIMATION,
    key,
    props
  };
}

/**
 * Action creator for when a user selects new frames to add to the animation.
 * Set these as pending before loading them into Piskel.
 * @param {!AnimationKey} key
 * @param {SerializedAnimation} props
 * @returns {{type: string, key: AnimationKey, props: SerializedAnimation}}
 */
function setPendingFramesAction(key, props) {
  return {
    type: SET_PENDING_FRAMES,
    key,
    props
  };
}

/**
 * Action creator for removing pending frames.
 * @returns {{type: string}}
 */
export function removePendingFramesAction() {
  return {
    type: REMOVE_PENDING_FRAMES
  };
}

/**
 * Action creator for when pending frames are done loading from the source url.
 * @returns {{type: string, key: AnimationKey, props: SerializedAnimation}}
 */
function doneLoadingPendingFramesFromSourceAction(key, loadedProps) {
  return {
    type: DONE_LOADING_PENDING_FRAMES_FROM_SOURCE,
    key,
    loadedProps
  };
}

/**
 * Action creator for when pending frames will start loading from the source url.
 * @returns {{type: string}}
 */
function startLoadingPendingFramesFromSourceAction() {
  return {
    type: START_LOADING_PENDING_FRAMES_FROM_SOURCE
  };
}

/**
 * Load the indicated animation from its source, whether that is S3 or the animation library.
 * From this function we'll need the dataURI and sourceSize to send to Piskel.
 * @param {!AnimationKey} key
 * @param {SerializedAnimation} props
 * @param {function} [callback]
 */
function loadPendingFramesFromSource(key, props, callback) {
  callback = callback || function() {};
  return (dispatch, getState) => {
    const state = getState();
    const sourceUrl = animationSourceUrl(
      key,
      props,
      state.pageConstants && state.pageConstants.channelId
    );
    dispatch(startLoadingPendingFramesFromSourceAction());
    fetchURLAsBlob(sourceUrl, (err, blob) => {
      if (err) {
        console.log('Failed to load pending animation frames' + key, err);
        dispatch(removePendingFramesAction());
        return;
      }
      blobToDataURI(blob, dataURI => {
        dataURIToSourceSize(dataURI).then(sourceSize => {
          dispatch(
            doneLoadingPendingFramesFromSourceAction(key, {
              blob,
              dataURI,
              sourceSize
            })
          );
          callback();
        });
      });
    });
  };
}

/**
 * Given a key/serialized-props pair for an animation, work out where to get
 * the spritesheet.
 * @param {!AnimationKey} key
 * @param {!SerializedAnimationProps} props
 * @param {string} channelId - Used to differentiate library animations
 * @returns {string}
 */
export function animationSourceUrl(key, props, channelId) {
  // If the animation has a sourceUrl it's external (from the library,
  // a levelbuilder, or an uploaded image) - and we may need to run it through
  // the media proxy.
  // ChannelId differentiates anims included by levelbuilders from project animations
  const fromLibraryOrLevelbuilder =
    props.sourceUrl && !props.sourceUrl.includes('v3/animations/' + channelId);
  const uploadedAnimation =
    props.sourceUrl && props.sourceUrl.includes('v3/animations/' + channelId);

  // No need to append a version for animations in the library/from levelbuilders
  // or if the srcUrl points to an uploaded animation and contains a version
  const versionNotNeeded =
    fromLibraryOrLevelbuilder ||
    (uploadedAnimation && props.sourceUrl.includes('?version'));

  if (versionNotNeeded) {
    return assetPrefix.fixPath(props.sourceUrl);
  } else if (uploadedAnimation) {
    if (props.version) {
      return assetPrefix.fixPath(props.sourceUrl) + '?version=' + props.version;
    } else {
      return assetPrefix.fixPath(props.sourceUrl) + '?version=latestVersion';
    }
  }

  // Animations that are not from the library, levelbuilder, or uploaded, should
  // use the animation key and version to look it up in the animations API.
  return animationsApi.basePath(key) + '.png?version=' + (props.version || '');
}

/**
 * Static helper for converting a serialized animation list to an exportable one
 * with absolute sourceUrls for the animations.
 * Only used for a levelbuilder utility.
 * @param {SerializedAnimationList} serializedList
 * @return {SerializedAnimationList} with aboslute sourceUrls for every animation.
 */
export function withAbsoluteSourceUrls(serializedList, channelId) {
  let list = _.cloneDeep(serializedList);
  list.orderedKeys.forEach(key => {
    let props = list.propsByKey[key];

    const relativeUrl = animationSourceUrl(key, props, channelId);
    const sourceLocation = document.createElement('a');
    sourceLocation.href = relativeUrl;
    props.sourceUrl = sourceLocation.href;
  });
  return list;
}

/**
 * Dispatch to save animations to S3.
 * @param {function} onComplete callback - when all animations are saved
 * @returns {function()}
 */
export function saveAnimations(onComplete) {
  return (dispatch, getState) => {
    const state = getState().animationList;
    // Animations with a sourceUrl are referencing an external spritesheet and
    // should not be saved - until an edit operation clears the sourceUrl.
    // Also check the saved flag, so we only upload animations that have changed.
    const changedAnimationKeys = state.orderedKeys.filter(
      key =>
        !state.propsByKey[key].sourceUrl &&
        state.propsByKey[key].blob &&
        !state.propsByKey[key].saved
    );
    Promise.all(
      changedAnimationKeys.map(key => {
        return saveAnimation(key, state.propsByKey[key]).then(action => {
          dispatch(action);
        });
      })
    )
      .then(() => {
        onComplete();
      })
      .catch(err => {
        // TODO: What should we really do in this case?
        console.log('Failed to save animations', err); // TODO: Remove?
        onComplete();
      });
  };
}

/**
 *
 * @param {AnimationKey} animationKey
 * @param {AnimationProps} animationProps
 * @return {Promise} which resolves to a redux action object
 */
export function saveAnimation(animationKey, animationProps) {
  return new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();

    const onError = function() {
      reject(new Error(`${xhr.status} ${xhr.statusText}`));
    };

    const onSuccess = function() {
      if (xhr.status >= 400) {
        onError();
        return;
      }

      try {
        const response = JSON.parse(xhr.responseText);
        resolve({
          type: ON_ANIMATION_SAVED,
          key: animationKey,
          version: response.versionId
        });
      } catch (e) {
        reject(e);
      }
    };

    xhr.addEventListener('load', onSuccess);
    xhr.addEventListener('error', onError);
    xhr.open('PUT', animationsApi.basePath(animationKey + '.png'), true);
    xhr.setRequestHeader('Content-type', 'image/png');
    xhr.send(animationProps.blob);
  });
}

/**
 * Selector for allAnimationsSingleFrame
 */
export function allAnimationsSingleFrameSelector(state) {
  return state.pageConstants.allAnimationsSingleFrame;
}
