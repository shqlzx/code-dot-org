/** @file Board controller for BBC micro:bit */
/* global SerialPort */ // Provided by the Code.org Browser

import {EventEmitter} from 'events'; // provided by webpack's node-libs-browser
import {
  createMicroBitComponents,
  cleanupMicroBitComponents,
  enableMicroBitComponents,
  componentConstructors
} from './MicroBitComponents';
import MBFirmataWrapper from './MBFirmataWrapper';
import ExternalLed from './ExternalLed';
import ExternalButton from './ExternalButton';
import CapacitiveTouchSensor from './CapacitiveTouchSensor';
import LedScreen from './LedScreen';
import {
  MICROBIT,
  MICROBIT_FIRMWARE_VERSION,
  FIRMWARE_VERSION_TIMEOUT,
  SQUARE_LEDS,
  CHECKMARK_LEDS,
  ALL_LEDS
} from './MicroBitConstants';
import {delayPromise} from '../../util/boardUtils';
import {
  SERIAL_BAUD,
  isWebSerialPort
} from '@cdo/apps/lib/kits/maker/util/boardUtils';
import {MAKER_TOOLKIT} from '@cdo/apps/lib/kits/maker/util/makerConstants';
import firehoseClient from '@cdo/apps/lib/util/firehose';

/**
 * Controller interface for BBC micro:bit board using
 * micro:bit Firmata firmware.
 * @extends EventEmitter
 * @implements MakerBoard
 */
export default class MicroBitBoard extends EventEmitter {
  constructor(port) {
    super();

    this.port = port;

    /** @private {Object} Map of component controllers */
    this.prewiredComponents_ = null;

    const portType = isWebSerialPort(port) ? navigator.serial : SerialPort;

    /** @private {MicrobitFirmataClient} serial port controller */
    this.boardClient_ = new MBFirmataWrapper(portType);

    /** @private {Array} List of dynamically-created component controllers. */
    this.dynamicComponents_ = [];

    this.interpreterReference_ = null;
  }

  /**
   * Open a connection to the board on its configured port.
   * @return {Promise}
   */
  connect() {
    return Promise.resolve()
      .then(() => this.checkExpectedFirmware())
      .then(() => this.initializeComponents());
  }

  /**
   * Create a serial port controller and open the serial port immediately.
   * @return {SerialPort}
   */
  openSerialPort() {
    const portName = this.port ? this.port.comName : undefined;
    const serialPort = new SerialPort(portName, {baudRate: SERIAL_BAUD});
    return Promise.resolve(serialPort);
  }

  /**
   * Create a serial port controller and open the Web Serial port immediately.
   * @param {Object} port
   * @return {Promise<SerialPort>}
   */
  openSerialPortWebSerial(port) {
    return port.openMBPort().then(() => port);
  }

  /**
   * Connect to the micro:bit firmata client. After connecting, check the firmata
   * version and firmware version response on the boardClient. If not connected
   * or a different firmware version discovered, reject. Otherwise, resolve.
   * Exposed as a separate step here for the sake of the setup page; generally
   * recommended to just call connect(), above.
   * @returns {Promise<void>}
   */
  checkExpectedFirmware() {
    if (!isWebSerialPort(this.port)) {
      // maker app pathway
      return Promise.resolve()
        .then(() => this.openSerialPort())
        .then(serialPort => this.boardClient_.connectBoard(serialPort))
        .then(() => {
          // Delay for 0.25 seconds to ensure we have time to receive the firmware version.
          return delayPromise(250);
        })
        .then(() => {
          if (
            this.boardClient_.firmwareVersion.includes(
              MICROBIT_FIRMWARE_VERSION
            )
          ) {
            return Promise.resolve();
          } else {
            if (this.boardClient_.firmwareVersion === '') {
              // Log if we were not able to determine the firmware version in time.
              firehoseClient.putRecord({
                study: MAKER_TOOLKIT,
                study_group: MICROBIT,
                event: FIRMWARE_VERSION_TIMEOUT
              });
              console.warn(
                'Firmware version not detected in time. Try refreshing the page.'
              );
            }
            return Promise.reject('Incorrect firmware detected');
          }
        })
        .catch(err => Promise.reject(err));
    } else {
      // webserial pathway
      return this.openSerialPortWebSerial(this.port)
        .then(serialPort => {
          return this.boardClient_.connectBoard(serialPort);
        })
        .then(() => {
          // Delay for 0.25 seconds to ensure we have time to receive the firmware version.
          return delayPromise(250);
        })
        .then(() => {
          if (
            this.boardClient_.firmwareVersion.includes(
              MICROBIT_FIRMWARE_VERSION
            )
          ) {
            return Promise.resolve();
          } else {
            if (this.boardClient_.firmwareVersion === '') {
              console.warn(
                'Firmware version not detected in time. Try refreshing the page.'
              );
            }
            return Promise.reject('Incorrect firmware detected');
          }
        })
        .catch(err => Promise.reject(err));
    }
  }

  /**
   * Initialize a set of component controllers.
   * Exposed as a separate step here for the sake of the setup page; generally
   * it'd be better to just call connect(), above.
   * @throws {Error} if called before connecting to firmware
   */
  initializeComponents() {
    return createMicroBitComponents(this.boardClient_).then(components => {
      this.prewiredComponents_ = {
        // board is assigned a copy of boardClient_ but with references to the WebSerialPortWrapper
        // removed. This avoids hitting a recursive loop (due to the emit functionality that's included
        // in the WebSerialPortWrapper) when we attempt to marshall the object across to the
        // interpreter.
        board: this.boardClient_.getBoardClientWithoutPort(),
        ...components
      };
    });
  }

  /**
   * Enable existing board components
   */
  enableComponents() {
    if (this.prewiredComponents_) {
      enableMicroBitComponents(this.prewiredComponents_);
    }
  }

  /**
   * @returns {boolean} whether a real board is currently connected or not.
   */
  boardConnected() {
    return !!this.boardClient_.myPort;
  }

  /**
   * Displays  to demonstrate successful connection
   * A square is drawn in a spiral and then a checkmark flashes 3 times
   * on the board.
   * @returns {Promise} resolved when the animation is done.
   */
  celebrateSuccessfulConnection() {
    function makeSquare(ledScreen, delay, timeInterval) {
      return new Promise(resolve => {
        SQUARE_LEDS.forEach((ledPair, i) => {
          setTimeout(
            () => ledScreen.on(ledPair[0], ledPair[1]),
            delay * (i + 1)
          );
        });
        setTimeout(resolve, delay * SQUARE_LEDS.length + timeInterval);
      });
    }

    function makeCheckMark(ledScreen, delay) {
      return new Promise(resolve => {
        CHECKMARK_LEDS.forEach(ledPair => {
          setTimeout(() => ledScreen.on(ledPair[0], ledPair[1]));
        });
        setTimeout(resolve, delay);
      });
    }

    function turnOffAllLeds(ledScreen, delay) {
      return new Promise(resolve => {
        ALL_LEDS.forEach(ledPair => {
          setTimeout(() => ledScreen.off(ledPair[0], ledPair[1]));
        });
        setTimeout(resolve, delay);
      });
    }

    this.initializeComponents().then(() => {
      const ledScreen = new LedScreen({
        mb: this.boardClient_
      });

      const timeInterval = 200;
      const squareTimeInterval = 70;

      return Promise.resolve()
        .then(() => makeSquare(ledScreen, squareTimeInterval, timeInterval))
        .then(() => turnOffAllLeds(ledScreen, timeInterval))
        .then(() => makeCheckMark(ledScreen, timeInterval))
        .then(() => turnOffAllLeds(ledScreen, timeInterval))
        .then(() => makeCheckMark(ledScreen, timeInterval))
        .then(() => turnOffAllLeds(ledScreen, timeInterval))
        .then(() => makeCheckMark(ledScreen, timeInterval));
    });
  }

  pinMode(pin, modeConstant) {
    this.boardClient_.setPinMode(pin, modeConstant);
  }

  digitalWrite(pin, value) {
    this.boardClient_.digitalWrite(pin, value);
  }

  digitalRead(pin, callback) {
    this.boardClient_.digitalRead(pin, callback);
  }

  analogWrite(pin, value) {
    this.boardClient_.analogWrite(pin, value);
  }

  analogRead(pin, callback) {
    this.boardClient_.analogRead(pin, callback);
  }

  createLed(pin) {
    const newLed = new ExternalLed({board: this.boardClient_, pin});
    this.dynamicComponents_.push(newLed);
    return newLed;
  }

  createButton(pin) {
    const newButton = new ExternalButton({mb: this.boardClient_, pin});
    this.dynamicComponents_.push(newButton);
    return newButton;
  }

  createCapacitiveTouchSensor(pin) {
    const newSensor = new CapacitiveTouchSensor({mb: this.boardClient_, pin});
    // Add the capacitive touch sensor to the interpreter
    // The interpreter reference is set during the board connection so
    // should be not-null here
    if (this.interpreterReference_) {
      this.interpreterReference_.addCustomMarshalObject({
        instance: CapacitiveTouchSensor
      });
      this.interpreterReference_.createGlobalProperty(
        'CapacitiveTouchSensor',
        CapacitiveTouchSensor
      );
    }

    this.dynamicComponents_.push(newSensor);
    return newSensor;
  }

  /**
   * Disconnect and clean up the board controller and all components.
   */
  destroy() {
    this.dynamicComponents_.forEach(component => {
      // For now, these are _always_ Leds.  Complain if they're not.
      if (component instanceof ExternalLed) {
        component.off();
      } else if (component instanceof ExternalButton) {
        // No special cleanup required for button
      } else {
        throw new Error('Added an unsupported component to dynamic components');
      }
    });
    this.dynamicComponents_.length = 0;

    if (this.prewiredComponents_) {
      cleanupMicroBitComponents(
        this.prewiredComponents_,
        this.dynamicComponents_,
        true /* shouldDestroyComponents */
      );
    }
    this.prewiredComponents_ = null;

    if (this.boardClient_) {
      this.boardClient_.disconnect();
      this.boardClient_.reset();
    }
    this.boardClient_ = null;

    return Promise.resolve();
  }

  /**
   * Marshals the board component controllers and appropriate constants into the
   * given JS Interpreter instance so they can be used by student code.
   * @param {JSInterpreter} jsInterpreter
   */
  installOnInterpreter(jsInterpreter) {
    this.interpreterReference_ = jsInterpreter;
    Object.keys(componentConstructors).forEach(key => {
      jsInterpreter.addCustomMarshalObject({
        instance: componentConstructors[key]
      });
      jsInterpreter.createGlobalProperty(key, componentConstructors[key]);
    });

    Object.keys(this.prewiredComponents_).forEach(key => {
      jsInterpreter.createGlobalProperty(key, this.prewiredComponents_[key]);
    });
  }

  reset() {
    cleanupMicroBitComponents(
      this.prewiredComponents_,
      this.dynamicComponents_,
      false /* shouldDestroyComponents */
    );
  }
}
