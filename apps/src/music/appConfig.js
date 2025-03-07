import {queryParams} from '@cdo/apps/code-studio/utils';
import {BlockMode} from './constants';

/**
 * Helper function for specifically fetching the 'blocks' config value. Provides
 * a default if an invalid value or no value is found.
 */
export const getBlockMode = () => {
  const defaultMode = BlockMode.SIMPLE2;

  let blockMode = queryParams('blocks') || defaultMode;
  blockMode = blockMode.replace(/^./, str => str.toUpperCase()); // Capitalize first letter if necessary

  if (!Object.values(BlockMode).includes(blockMode)) {
    console.warn(
      `Invalid block mode: ${blockMode}. Falling back to default (${defaultMode})`
    );
    blockMode = defaultMode;
  }

  return blockMode;
};

export default {
  getValue(name) {
    return queryParams(name);
  }
};
