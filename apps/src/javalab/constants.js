/**
 * NOTE: Constants in this file are generally shared by Javabuilder.
 * Check their use in the Javabuilder repo before editing.
 */
import {makeEnum} from '@cdo/apps/utils';

export const CsaViewMode = {
  NEIGHBORHOOD: 'neighborhood',
  CONSOLE: 'console',
  THEATER: 'theater'
};

export const WebSocketMessageType = {
  NEIGHBORHOOD: 'NEIGHBORHOOD',
  THEATER: 'THEATER',
  SYSTEM_OUT: 'SYSTEM_OUT',
  EXCEPTION: 'EXCEPTION',
  DEBUG: 'DEBUG',
  STATUS: 'STATUS',
  TEST_RESULT: 'TEST_RESULT',
  AUTHORIZER: 'AUTHORIZER',
  CONNECTED: 'CONNECTED'
};

export const JavabuilderExceptionType = {
  CLASS_NOT_FOUND: 'CLASS_NOT_FOUND',
  COMPILER_ERROR: 'COMPILER_ERROR',
  CONNECTION_POOL_SHUT_DOWN: 'CONNECTION_POOL_SHUT_DOWN',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  ILLEGAL_METHOD_ACCESS: 'ILLEGAL_METHOD_ACCESS',
  INTERNAL_COMPILER_EXCEPTION: 'INTERNAL_COMPILER_EXCEPTION',
  INTERNAL_EXCEPTION: 'INTERNAL_EXCEPTION',
  INTERNAL_RUNTIME_EXCEPTION: 'INTERNAL_RUNTIME_EXCEPTION',
  INVALID_CLASS: 'INVALID_CLASS',
  INVALID_JAVA_FILE_NAME: 'INVALID_JAVA_FILE_NAME',
  INVALID_MAIN_METHOD: 'INVALID_MAIN_METHOD',
  JAVA_EXTENSION_MISSING: 'JAVA_EXTENSION_MISSING',
  LOW_DISK_SPACE: 'LOW_DISK_SPACE',
  MISSING_PROJECT_FILE_NAME: 'MISSING_PROJECT_FILE_NAME',
  NO_FILES_TO_COMPILE: 'NO_FILES_TO_COMPILE',
  NO_MAIN_METHOD: 'NO_MAIN_METHOD',
  RUNTIME_ERROR: 'RUNTIME_ERROR',
  TEMP_DIRECTORY_CLEANUP_ERROR: 'TEMP_DIRECTORY_CLEANUP_ERROR',
  TWO_MAIN_METHODS: 'TWO_MAIN_METHODS',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

export const NeighborhoodSignalType = {
  // Move the painter
  MOVE: 'MOVE',
  // Initialize the painter
  INITIALIZE_PAINTER: 'INITIALIZE_PAINTER',
  // Add paint to the current location
  PAINT: 'PAINT',
  // Remove all paint from current location
  REMOVE_PAINT: 'REMOVE_PAINT',
  // Take paint from the bucket
  TAKE_PAINT: 'TAKE_PAINT',
  // Hide the painter on the screen
  HIDE_PAINTER: 'HIDE_PAINTER',
  // Show the painter on the screen
  SHOW_PAINTER: 'SHOW_PAINTER',
  // Turn the painter left
  TURN_LEFT: 'TURN_LEFT',
  // Hide all paint buckets
  HIDE_BUCKETS: 'HIDE_BUCKETS',
  // Show all paint buckets
  SHOW_BUCKETS: 'SHOW_BUCKETS',
  // We will not receive any more commands
  DONE: 'DONE'
};

export const NeighborhoodExceptionType = makeEnum(
  'INVALID_GRID',
  'INVALID_DIRECTION',
  'GET_SQUARE_FAILED',
  'INVALID_COLOR',
  'INVALID_LOCATION',
  'INVALID_MOVE',
  'INVALID_PAINT_LOCATION'
);

export const TheaterSignalType = {
  // This message contains the url to an audio element
  AUDIO_URL: 'AUDIO_URL',
  // This message contains the url to a visual element
  VISUAL_URL: 'VISUAL_URL',
  // Get an image from the user via Prompter
  GET_IMAGE: 'GET_IMAGE',
  // There is no audio
  NO_AUDIO: 'NO_AUDIO'
};

export const StatusMessageType = {
  COMPILING: 'COMPILING',
  COMPILATION_SUCCESSFUL: 'COMPILATION_SUCCESSFUL',
  RUNNING: 'RUNNING',
  GENERATING_RESULTS: 'GENERATING_RESULTS',
  GENERATING_PROGRESS: 'GENERATING_PROGRESS',
  SENDING_VIDEO: 'SENDING_VIDEO',
  TIMEOUT_WARNING: 'TIMEOUT_WARNING',
  TIMEOUT: 'TIMEOUT',
  EXITED: 'EXITED',
  RUNNING_VALIDATION: 'RUNNING_VALIDATION',
  RUNNING_PROJECT_TESTS: 'RUNNING_PROJECT_TESTS',
  NO_TESTS_FOUND: 'NO_TESTS_FOUND'
};

export const InputMessageType = {
  SYSTEM_IN: 'SYSTEM_IN',
  THEATER: 'THEATER'
};

export const InputMessage = {
  // Theater-specific messages
  UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
  UPLOAD_ERROR: 'UPLOAD_ERROR'
};

export const SoundExceptionType = makeEnum(
  'INVALID_AUDIO_FILE_FORMAT',
  'MISSING_AUDIO_DATA'
);

export const MediaExceptionType = makeEnum('IMAGE_LOAD_ERROR');

export const TheaterExceptionType = makeEnum(
  'DUPLICATE_PLAY_COMMAND',
  'INVALID_SHAPE',
  'VIDEO_TOO_LONG',
  'VIDEO_TOO_LARGE'
);

export const CompileStatus = makeEnum('NONE', 'LOADING', 'SUCCESS', 'ERROR');

export const STATUS_MESSAGE_PREFIX = '[JAVALAB]';

export const ExecutionType = {
  // Compile and run the main method
  RUN: 'RUN',
  // Compile and run tests
  TEST: 'TEST'
};

export const UserTestResultSignalType = {
  TEST_STATUS: 'TEST_STATUS',
  STATUS_DETAILS: 'STATUS_DETAILS'
};

export const TestStatus = {
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED'
};

export const AuthorizerSignalType = {
  TOKEN_USED: 'TOKEN_USED',
  NEAR_LIMIT: 'NEAR_LIMIT',
  USER_BLOCKED: 'USER_BLOCKED',
  CLASSROOM_BLOCKED: 'CLASSROOM_BLOCKED'
};
