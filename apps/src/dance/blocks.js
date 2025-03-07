import i18n from '@cdo/locale';

// This color palette is limited to colors which have different hues, therefore
// it should not contain different shades of the same color such as
// ['#ff0000', '#cc0000', '#880000'].
const limitedColours = [
  // fully-saturated primary colors
  '#ff0000', // RED
  '#00ff00', // GREEN
  '#0000ff', // BLUE

  // fully-saturated secondary colors
  '#ffff00', // YELLOW
  '#00ffff', // CYAN
  '#ff00ff', // MAGENTA

  // some "tertiary" colors
  '#ff8800', // ORANGE
  '#8800ff', // PURPLE
  '#00ff88' // LIME
];

const customInputTypes = {
  spritePicker: {
    addInput(blockly, block, inputConfig, currentInputRow) {
      block.getVars = function() {
        return {
          [Blockly.BlockValueType.SPRITE]: [
            block.getFieldValue(inputConfig.name)
          ]
        };
      };
      block.renameVar = function(oldName, newName) {
        if (
          Blockly.Names.equals(oldName, block.getFieldValue(inputConfig.name))
        ) {
          block.setTitleValue(newName, inputConfig.name);
        }
      };
      block.removeVar = function(oldName) {
        if (
          Blockly.Names.equals(oldName, block.getFieldValue(inputConfig.name))
        ) {
          block.dispose(true, true);
        }
      };
      block.superSetTitleValue = block.setTitleValue;
      block.setTitleValue = function(newValue, name) {
        if (name === inputConfig.name && block.blockSpace.isFlyout) {
          newValue = Blockly.Variables.generateUniqueName(newValue);
        }
        block.superSetTitleValue(newValue, name);
      };

      currentInputRow
        .appendField(inputConfig.label)
        .appendField(
          new Blockly.FieldVariable(
            null,
            null,
            null,
            Blockly.BlockValueType.SPRITE,
            i18n.sprite()
          ),
          inputConfig.name
        );
    },
    generateCode(block, arg) {
      return `'${block.getFieldValue(arg.name)}'`;
    }
  },
  limitedColourPicker: {
    addInput(blockly, block, inputConfig, currentInputRow) {
      const options = {
        colours: limitedColours,
        columns: 3
      };
      currentInputRow
        .appendField(inputConfig.label)
        .appendField(
          new Blockly.FieldColour('#ff0000', undefined, options),
          'VAL'
        );
    },
    generateCode(block, arg) {
      return `'${block.getFieldValue(arg.name)}'`;
    }
  }
};

export default {
  customInputTypes,
  install(blockly, blockInstallOptions) {
    // Legacy style block definitions :(
    const generator = blockly.getGenerator();

    const behaviorEditor = (Blockly.behaviorEditor = new Blockly.FunctionEditor(
      {
        FUNCTION_HEADER: i18n.behaviorEditorHeader(),
        FUNCTION_NAME_LABEL: i18n.behaviorEditorLabel(),
        FUNCTION_DESCRIPTION_LABEL: i18n.behaviorEditorDescription()
      },
      'behavior_definition',
      {
        [Blockly.BlockValueType.SPRITE]: 'sprite_parameter_get'
      },
      false /* disableParamEditing */,
      [
        Blockly.BlockValueType.NUMBER,
        Blockly.BlockValueType.STRING,
        Blockly.BlockValueType.COLOUR,
        Blockly.BlockValueType.BOOLEAN,
        Blockly.BlockValueType.SPRITE,
        Blockly.BlockValueType.LOCATION
      ]
    ));

    Blockly.Blocks.sprite_variables_get = {
      // Variable getter.
      init: function() {
        var fieldLabel = new Blockly.FieldLabel(Blockly.Msg.VARIABLES_GET_ITEM);
        // Must be marked EDITABLE so that cloned blocks share the same var name
        fieldLabel.EDITABLE = true;
        this.setHelpUrl(Blockly.Msg.VARIABLES_GET_HELPURL);
        this.appendDummyInput()
          .appendField(Blockly.Msg.VARIABLES_GET_TITLE)
          .appendField(
            Blockly.disableVariableEditing
              ? fieldLabel
              : new Blockly.FieldVariable(
                  Blockly.Msg.VARIABLES_SET_ITEM,
                  null,
                  null,
                  Blockly.BlockValueType.SPRITE,
                  i18n.sprite()
                ),
            'VAR'
          )
          .appendField(Blockly.Msg.VARIABLES_GET_TAIL);
        this.setStrictOutput(true, Blockly.BlockValueType.SPRITE);
        this.setTooltip(Blockly.Msg.VARIABLES_GET_TOOLTIP);
      },
      getVars: function() {
        return Blockly.Variables.getVars.bind(this)(
          Blockly.BlockValueType.SPRITE
        );
      },
      renameVar: function(oldName, newName) {
        if (Blockly.Names.equals(oldName, this.getFieldValue('VAR'))) {
          this.setTitleValue(newName, 'VAR');
        }
      },
      removeVar: Blockly.Blocks.variables_get.removeVar
    };
    generator.sprite_variables_get = function() {
      return [
        `'${this.getFieldValue('VAR')}'`,
        Blockly.JavaScript.ORDER_ATOMIC
      ];
    };
    Blockly.Variables.registerGetter(
      Blockly.BlockValueType.SPRITE,
      'sprite_variables_get'
    );

    Blockly.Blocks.sprite_parameter_get = {
      init() {
        var fieldLabel = new Blockly.FieldLabel(Blockly.Msg.VARIABLES_GET_ITEM);
        // Must be marked EDITABLE so that cloned blocks share the same var name
        fieldLabel.EDITABLE = true;
        this.setHelpUrl(Blockly.Msg.VARIABLES_GET_HELPURL);
        this.appendDummyInput()
          .appendField(Blockly.Msg.VARIABLES_GET_TITLE)
          .appendField(fieldLabel, 'VAR')
          .appendField(Blockly.Msg.VARIABLES_GET_TAIL);
        this.setStrictOutput(true, Blockly.BlockValueType.SPRITE);
        this.setTooltip(Blockly.Msg.VARIABLES_GET_TOOLTIP);
      },
      renameVar(oldName, newName) {
        if (behaviorEditor.isOpen()) {
          behaviorEditor.renameParameter(oldName, newName);
          behaviorEditor.refreshParamsEverywhere();
        }
      },
      removeVar: Blockly.Blocks.variables_get.removeVar
    };
    generator.sprite_parameter_get = generator.variables_get;

    Blockly.Blocks.gamelab_behavior_get = {
      init() {
        var fieldLabel = new Blockly.FieldLabel(Blockly.Msg.VARIABLES_GET_ITEM);
        // Must be marked EDITABLE so that cloned blocks share the same var name
        fieldLabel.EDITABLE = true;
        this.setHelpUrl(Blockly.Msg.VARIABLES_GET_HELPURL);
        Blockly.cdoUtils.setHSV(this, 631, 0.84, 0.8);
        const mainTitle = this.appendDummyInput()
          .appendField(fieldLabel, 'VAR')
          .appendField(Blockly.Msg.VARIABLES_GET_TAIL);

        if (Blockly.useModalFunctionEditor) {
          var editLabel = new Blockly.FieldIcon(Blockly.Msg.FUNCTION_EDIT);
          Blockly.cdoUtils.bindBrowserEvent(
            editLabel.fieldGroup_,
            'mousedown',
            this,
            this.openEditor
          );
          mainTitle.appendField(editLabel);
        }

        this.setStrictOutput(true, Blockly.BlockValueType.BEHAVIOR);
        this.setTooltip(Blockly.Msg.VARIABLES_GET_TOOLTIP);
        this.currentParameterNames_ = [];
      },

      openEditor(e) {
        e.stopPropagation();
        behaviorEditor.openEditorForFunction(this, this.getFieldValue('VAR'));
      },

      getVars() {
        return Blockly.Variables.getVars.bind(this)(
          Blockly.BlockValueType.BEHAVIOR
        );
      },

      renameVar(oldName, newName) {
        if (Blockly.Names.equals(oldName, this.getFieldValue('VAR'))) {
          this.setTitleValue(newName, 'VAR');
        }
      },

      renameProcedure(oldName, newName) {
        if (Blockly.Names.equals(oldName, this.getFieldValue('VAR'))) {
          this.setTitleValue(newName, 'VAR');
        }
      },

      getCallName() {
        return this.getFieldValue('VAR');
      },

      setProcedureParameters(paramNames, paramIds, typeNames) {
        Blockly.Blocks.procedures_callnoreturn.setProcedureParameters.call(
          this,
          paramNames.slice(1),
          paramIds && paramIds.slice(1),
          typeNames && typeNames.slice(1)
        );
      },

      mutationToDom() {
        const container = document.createElement('mutation');
        for (let x = 0; x < this.currentParameterNames_.length; x++) {
          const parameter = document.createElement('arg');
          parameter.setAttribute('name', this.currentParameterNames_[x]);
          if (this.currentParameterTypes_[x]) {
            parameter.setAttribute('type', this.currentParameterTypes_[x]);
          }
          container.appendChild(parameter);
        }
        return container;
      },

      domToMutation(xmlElement) {
        this.currentParameterNames_ = [];
        this.currentParameterTypes_ = [];
        for (let childNode of xmlElement.childNodes) {
          if (childNode.nodeName.toLowerCase() === 'arg') {
            this.currentParameterNames_.push(childNode.getAttribute('name'));
            this.currentParameterTypes_.push(childNode.getAttribute('type'));
          }
        }
        // Use parameter names as dummy IDs during initialization. Add dummy
        // "this_sprite" param.
        this.setProcedureParameters(
          [null].concat(this.currentParameterNames_),
          [null].concat(this.currentParameterNames_),
          [null].concat(this.currentParameterTypes_)
        );
      }
    };

    generator.gamelab_behavior_get = function() {
      const name = Blockly.JavaScript.variableDB_.getName(
        this.getFieldValue('VAR'),
        Blockly.Procedures.NAME_TYPE
      );
      const extraArgs = [];
      for (let x = 0; x < this.currentParameterNames_.length; x++) {
        extraArgs[x] =
          Blockly.JavaScript.valueToCode(
            this,
            'ARG' + x,
            Blockly.JavaScript.ORDER_COMMA
          ) || 'null';
      }
      return [
        `new Behavior(${name}, [${extraArgs.join(', ')}])`,
        Blockly.JavaScript.ORDER_ATOMIC
      ];
    };

    Blockly.Blocks.behavior_definition = Blockly.Block.createProcedureDefinitionBlock(
      {
        initPostScript(block) {
          block.setHSV(136, 0.84, 0.8);
          block.parameterNames_ = ['this sprite'];
          block.parameterTypes_ = [Blockly.BlockValueType.SPRITE];
        },
        overrides: {
          getVars(category) {
            return {
              Behavior: [this.getFieldValue('NAME')]
            };
          },
          callType_: 'gamelab_behavior_get'
        }
      }
    );

    generator.behavior_definition = generator.procedures_defnoreturn;

    Blockly.Procedures.DEFINITION_BLOCK_TYPES.push('behavior_definition');
    Blockly.Variables.registerGetter(
      Blockly.BlockValueType.BEHAVIOR,
      'gamelab_behavior_get'
    );
    Blockly.Flyout.configure(Blockly.BlockValueType.BEHAVIOR, {
      initialize(flyout, cursor) {
        if (behaviorEditor && !behaviorEditor.isOpen()) {
          flyout.addButtonToFlyout_(
            cursor,
            i18n.createBlocklyBehavior(),
            behaviorEditor.openWithNewFunction.bind(behaviorEditor)
          );
        }
      },
      addDefaultVar: false
    });
    delete blockly.Blocks.procedures_defreturn;
    delete blockly.Blocks.procedures_ifreturn;
  }
};
