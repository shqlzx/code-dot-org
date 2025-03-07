/** @file Dropdown for selecting design mode screens */
import PropTypes from 'prop-types';
import React from 'react';
import * as constants from './constants';
import {connect} from 'react-redux';
import style from './screen-selector.module.scss';
import * as elementUtils from './designElements/elementUtils';
import * as screens from './redux/screens';

/**
 * The dropdown that appears above the visualization in design mode, used
 * for selecting a screen to edit.
 * @type {function}
 */
class ScreenSelector extends React.Component {
  static propTypes = {
    // from connect
    currentScreenId: PropTypes.string,
    interfaceMode: PropTypes.string.isRequired,
    hasDesignMode: PropTypes.bool.isRequired,
    onScreenChange: PropTypes.func.isRequired,
    onImport: PropTypes.func.isRequired,
    isRunning: PropTypes.bool.isRequired,

    // passed explicitly
    screenIds: PropTypes.array.isRequired,
    onCreate: PropTypes.func.isRequired
  };

  handleChange = evt => {
    let screenId = evt.target.value;
    if (screenId === constants.NEW_SCREEN) {
      screenId = this.props.onCreate();
    } else if (screenId === constants.IMPORT_SCREEN) {
      this.props.onImport();
      return;
    }
    this.props.onScreenChange(screenId);
  };

  render() {
    if (!this.props.hasDesignMode) {
      return null;
    }

    const options = this.props.screenIds.map(function(item) {
      return (
        <option key={item} value={item}>
          {item}
        </option>
      );
    });

    const defaultScreenId =
      elementUtils
        .getScreens()
        .first()
        .attr('id') || '';

    options.sort(function(a, b) {
      if (a.key === defaultScreenId) {
        return -1;
      } else if (b.key === defaultScreenId) {
        return 1;
      } else {
        return a.key.localeCompare(b.key);
      }
    });

    const canAddScreen =
      this.props.interfaceMode === constants.ApplabInterfaceMode.DESIGN;

    return (
      <select
        id="screenSelector"
        className={style.dropdown}
        value={this.props.currentScreenId || ''}
        onChange={this.handleChange}
        disabled={this.props.isRunning}
      >
        {options}
        {canAddScreen && <option>{constants.IMPORT_SCREEN}</option>}
        {canAddScreen && <option>{constants.NEW_SCREEN}</option>}
      </select>
    );
  }
}

export default connect(
  function propsFromStore(state) {
    return {
      currentScreenId: state.screens.currentScreenId,
      interfaceMode: state.interfaceMode,
      hasDesignMode: state.pageConstants.hasDesignMode,
      isRunning: state.runState.isRunning
    };
  },
  function propsFromDispatch(dispatch) {
    return {
      onScreenChange: function(screenId) {
        dispatch(screens.changeScreen(screenId));
      },
      onImport() {
        dispatch(screens.toggleImportScreen(true));
      }
    };
  }
)(ScreenSelector);
