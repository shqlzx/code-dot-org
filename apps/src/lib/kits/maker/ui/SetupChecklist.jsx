/** @file Maker Board setup checker */
import PropTypes from 'prop-types';

import React, {Component} from 'react';
import * as utils from '../../../../utils';
import trackEvent from '../../../../util/trackEvent';
import SetupChecker from '../util/SetupChecker';
import SafeMarkdown from '@cdo/apps/templates/SafeMarkdown';
import i18n from '@cdo/locale';
import applabI18n from '@cdo/applab/locale';
import {
  isWindows,
  isChrome,
  isChromeOS,
  isCodeOrgBrowser,
  isLinux
} from '../util/browserChecks';
import ValidationStep, {Status} from '../../../ui/ValidationStep';
import experiments from '@cdo/apps/util/experiments';
import {BOARD_TYPE, shouldUseWebSerial, delayPromise} from '../util/boardUtils';
import {CHROME_APP_WEBSTORE_URL} from '../util/makerConstants';
import WebSerialPortWrapper from '@cdo/apps/lib/kits/maker/WebSerialPortWrapper';

const STATUS_SUPPORTED_BROWSER = 'statusSupportedBrowser';
const STATUS_APP_INSTALLED = 'statusAppInstalled';
const STATUS_BOARD_PLUG = 'statusBoardPlug';
const STATUS_BOARD_CONNECT = 'statusBoardConnect';
const STATUS_BOARD_COMPONENTS = 'statusBoardComponents';

const MICROBIT_FIRMATA_URL =
  'https://github.com/microbit-foundation/microbit-firmata#installing-firmata-on-your-bbc-microbit';
const EXPRESS_FIRMATA_URL =
  'https://learn.adafruit.com/adafruit-circuit-playground-express/code-org-csd';
const CLASSIC_FIRMATA_URL =
  'https://learn.adafruit.com/circuit-playground-firmata/overview';

const initialState = {
  isDetecting: false,
  caughtError: null,
  boardTypeDetected: BOARD_TYPE.OTHER,
  [STATUS_SUPPORTED_BROWSER]: Status.WAITING,
  [STATUS_APP_INSTALLED]: Status.WAITING,
  [STATUS_BOARD_PLUG]: Status.WAITING,
  [STATUS_BOARD_CONNECT]: Status.WAITING,
  [STATUS_BOARD_COMPONENTS]: Status.WAITING
};

export default class SetupChecklist extends Component {
  state = {...initialState};

  static propTypes = {
    webSerialPort: PropTypes.object,
    stepDelay: PropTypes.number
  };

  fail(selector) {
    this.setState({[selector]: Status.FAILED});
  }

  spin(selector) {
    this.setState({[selector]: Status.ATTEMPTING});
  }

  succeed(selector) {
    this.setState({[selector]: Status.SUCCEEDED});
  }

  thumb(selector) {
    this.setState({[selector]: Status.CELEBRATING});
  }

  detect() {
    const {webSerialPort} = this.props;
    const wrappedSerialPort = webSerialPort
      ? new WebSerialPortWrapper(webSerialPort)
      : null;
    const setupChecker = new SetupChecker(wrappedSerialPort);
    this.setState({...initialState, isDetecting: true});

    Promise.resolve()

      // Are we using a compatible browser?
      .then(() =>
        this.detectStep(STATUS_SUPPORTED_BROWSER, () =>
          setupChecker.detectSupportedBrowser()
        )
      )

      // Is Chrome App Installed?
      .then(
        () =>
          // Only necessary for ChromeOS when not using webserial
          (isChromeOS() || isChrome()) &&
          !shouldUseWebSerial() &&
          this.detectStep(STATUS_APP_INSTALLED, () =>
            setupChecker.detectChromeAppInstalled()
          )
      )

      // Is board plugged in?
      .then(() =>
        this.detectStep(STATUS_BOARD_PLUG, () =>
          setupChecker.detectBoardPluggedIn()
        )
      )

      // What type of board is this?
      .then(() => {
        this.setState({boardTypeDetected: setupChecker.detectBoardType()});
        if (experiments.isEnabled('microbit')) {
          console.log('Board detected: ' + setupChecker.detectBoardType());
        }
        Promise.resolve();
      })

      // Can we talk to the firmware?
      .then(() =>
        this.detectStep(STATUS_BOARD_CONNECT, () =>
          setupChecker.detectCorrectFirmware(this.state.boardTypeDetected)
        )
      )

      // Can we initialize components successfully?
      .then(() => {
        if (this.state.boardTypeDetected !== BOARD_TYPE.MICROBIT) {
          return this.detectStep(STATUS_BOARD_COMPONENTS, () =>
            setupChecker.detectComponentsInitialize()
          );
        }
        return Promise.resolve();
      })

      // Everything looks good, let's par-tay!
      .then(() =>
        this.thumb(
          this.state.boardTypeDetected === BOARD_TYPE.MICROBIT
            ? STATUS_BOARD_CONNECT
            : STATUS_BOARD_COMPONENTS
        )
      )
      .then(() => setupChecker.celebrate())
      .then(() => delayPromise(3000)) // allow 3 seconds for 'celebrate' on Micro:Bit before disconnecting
      .then(() => this.succeed(STATUS_BOARD_COMPONENTS))
      .then(() => trackEvent('MakerSetup', 'ConnectionSuccess'))

      // If anything goes wrong along the way, we'll end up in this
      // catch clause - make sure to report the error out.
      .catch(error => {
        const extraErrorInfo = {};
        this.setState({caughtError: error, ...extraErrorInfo});
        trackEvent('MakerSetup', 'ConnectionError');
        if (console && typeof console.error === 'function') {
          console.error(error);
        }
      })

      // Finally...
      .then(() => {
        setupChecker.teardown();
        this.setState({isDetecting: false});
      });
  }

  /**
   * Perform the work to check a step, wrapped in appropriate status changes.
   * @param {string} stepKey
   * @param {function:Promise} stepWork
   * @return {Promise}
   */
  detectStep(stepKey, stepWork) {
    this.spin(stepKey);
    return promiseWaitFor(this.props.stepDelay || 200)
      .then(stepWork)
      .then(() => this.succeed(stepKey))
      .catch(error => {
        this.fail(stepKey);
        return Promise.reject(error);
      });
  }

  /**
   * Helper to be used on second/subsequent attempts at detecting board usability.
   */
  redetect() {
    if (
      this.state[STATUS_SUPPORTED_BROWSER] !== Status.SUCCEEDED ||
      ((isChromeOS() || isChrome()) &&
        this.state[STATUS_APP_INSTALLED] !== Status.SUCCEEDED)
    ) {
      // If the Chrome app was not installed last time we checked, but has been
      // installed since, we'll probably need a full page reload to pick it up.
      utils.reload();
    } else {
      // Otherwise we should be able to redetect without a page reload.
      this.detect();
    }
  }

  componentDidMount() {
    this.detect();
  }

  renderPlatformSpecificSteps() {
    if (isCodeOrgBrowser()) {
      // Maker Toolkit Standalone App
      return (
        <ValidationStep
          stepName={applabI18n.makerSetupBrowserTitle()}
          stepStatus={this.state[STATUS_SUPPORTED_BROWSER]}
        />
      );
    } else if (isChromeOS() || isChrome()) {
      if (shouldUseWebSerial()) {
        return (
          <ValidationStep
            stepName={applabI18n.makerSetupBrowserSupported()}
            stepStatus={this.state[STATUS_SUPPORTED_BROWSER]}
          />
        );
      } else {
        // Chromebooks - Chrome App
        return (
          <ValidationStep
            stepName={
              applabI18n.makerSetupAppInstalled() +
              (isChromeOS() ? '' : applabI18n.legacy())
            }
            stepStatus={this.state[STATUS_APP_INSTALLED]}
          >
            <SafeMarkdown
              markdown={applabI18n.makerSetupInstallSerialConnector({
                webstoreURL: CHROME_APP_WEBSTORE_URL
              })}
            />
            <br />
            {applabI18n.makerSetupRedetect()}
            <br />
            {applabI18n.makerSetupAcceptPrompt()}
            {this.contactSupport()}
          </ValidationStep>
        );
      }
    } else {
      // Unsupported Browser
      return (
        <ValidationStep
          stepName={applabI18n.makerSetupBrowserSupported()}
          stepStatus={Status.FAILED}
        >
          <SafeMarkdown markdown={applabI18n.makerSetupUnsupportedBrowser()} />
        </ValidationStep>
      );
    }
  }

  contactSupport() {
    return <SafeMarkdown markdown={i18n.contactGeneralSupport()} />;
  }

  installFirmwareSketch() {
    let firmataMarkdown;
    if (this.state.boardTypeDetected === BOARD_TYPE.MICROBIT) {
      firmataMarkdown = applabI18n.makerSetupInstallFirmataMB({
        firmataURL: MICROBIT_FIRMATA_URL
      });
    } else if (
      this.state.boardTypeDetected === BOARD_TYPE.EXPRESS ||
      this.state.boardTypeDetected === BOARD_TYPE.CLASSIC
    ) {
      firmataMarkdown = applabI18n.makerSetupInstallFirmataCP({
        firmataURLExpress: EXPRESS_FIRMATA_URL,
        firmataURLClassic: CLASSIC_FIRMATA_URL
      });
    } else {
      // Board Type is Other/Unknown
      if (experiments.isEnabled('microbit')) {
        firmataMarkdown = applabI18n.makerSetupInstallFirmataOther({
          firmataURLExpress: EXPRESS_FIRMATA_URL,
          firmataURLClassic: CLASSIC_FIRMATA_URL,
          firmataURLMB: MICROBIT_FIRMATA_URL
        });
      } else {
        firmataMarkdown = applabI18n.makerSetupInstallFirmataCP({
          firmataURLExpress: EXPRESS_FIRMATA_URL,
          firmataURLClassic: CLASSIC_FIRMATA_URL
        });
      }
    }
    return (
      <div style={styles.suggestionHeader}>
        <SafeMarkdown markdown={firmataMarkdown} />
      </div>
    );
  }

  render() {
    const linuxPermissionError =
      isLinux() &&
      this.state.caughtError?.message?.includes('Permission denied');

    return (
      <div>
        <h2>
          {applabI18n.makerSetupCheck()}
          <input
            style={{marginLeft: 9, marginTop: -4}}
            className="btn"
            type="button"
            value={applabI18n.redetect()}
            onClick={this.redetect.bind(this)}
            disabled={this.state.isDetecting}
          />
        </h2>
        <div className="setup-status">
          {this.renderPlatformSpecificSteps()}
          <ValidationStep
            stepStatus={this.state[STATUS_BOARD_PLUG]}
            stepName={i18n.validationStepBoardPluggedIn()}
            hideWaitingSteps={true}
          >
            {this.state.caughtError && this.state.caughtError.reason && (
              <pre>{this.state.caughtError.reason}</pre>
            )}
            {applabI18n.makerSetupPlugInBoardCheck()}
            <a href="#" onClick={this.redetect.bind(this)}>
              {applabI18n.redetect()}
            </a>
            .
            {isWindows() && (
              <SafeMarkdown
                markdown={applabI18n.makerSetupAdafruitWindowsDrivers()}
              />
            )}
            {this.contactSupport()}
          </ValidationStep>
          <ValidationStep
            stepStatus={this.state[STATUS_BOARD_CONNECT]}
            stepName={i18n.validationStepBoardConnectable()}
            hideWaitingSteps={true}
          >
            {applabI18n.makerSetupBoardBadResponse()}
            {linuxPermissionError && (
              <div>
                <p>{applabI18n.makerSetupLinuxSerialport()}</p>
                <p>{applabI18n.makerSetupLinuxGroupsCheck()}</p>
                <pre>groups $&#123;USER&#125;</pre>
                <p>{applabI18n.makerSetupLinuxAddDialout()}</p>
                <pre>sudo gpasswd --add $&#123;USER&#125; dialout</pre>
                <p> {applabI18n.makerSetupLinuxRestart()} </p>
              </div>
            )}
            {!linuxPermissionError && this.installFirmwareSketch()}
            {this.contactSupport()}
          </ValidationStep>
          {this.state.boardTypeDetected !== BOARD_TYPE.MICROBIT && (
            <ValidationStep
              stepStatus={this.state[STATUS_BOARD_COMPONENTS]}
              stepName={i18n.validationStepBoardComponentsUsable()}
              hideWaitingSteps={true}
            >
              {applabI18n.makerSetupVerifyComponents()}
              <br />
              {this.installFirmwareSketch()}
              {this.contactSupport()}
            </ValidationStep>
          )}
        </div>
      </div>
    );
  }
}

function promiseWaitFor(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

const styles = {
  suggestionHeader: {
    marginTop: 15
  }
};
