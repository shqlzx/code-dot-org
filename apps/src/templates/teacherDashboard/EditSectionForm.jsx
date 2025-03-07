import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {connect} from 'react-redux';
import {Heading1, h3Style} from '../../lib/ui/Headings';
import * as styleConstants from '@cdo/apps/styleConstants';
import Button from '../Button';
import AssignmentSelector from '@cdo/apps/templates/teacherDashboard/AssignmentSelector';
import {sectionShape, assignmentCourseOfferingShape} from './shapes';
import DialogFooter from './DialogFooter';
import i18n from '@cdo/locale';
import {
  assignedUnitName,
  assignedUnitTextToSpeechEnabled,
  editSectionProperties,
  finishEditingSection,
  cancelEditingSection,
  reloadAfterEditingSection,
  assignedUnitLessonExtrasAvailable,
  assignedUnitRequiresVerifiedInstructor
} from './teacherSectionsRedux';
import {
  isScriptHiddenForSection,
  updateHiddenScript
} from '@cdo/apps/code-studio/hiddenLessonRedux';
import ConfirmHiddenAssignment from '../courseOverview/ConfirmHiddenAssignment';
import {
  SectionLoginType,
  StudentGradeLevels
} from '@cdo/apps/util/sharedConstants';
import firehoseClient from '@cdo/apps/lib/util/firehose';
import analyticsReporter from '@cdo/apps/lib/util/AnalyticsReporter';
import {EVENTS} from '@cdo/apps/lib/util/AnalyticsConstants';
import {ParticipantAudience} from '../../generated/curriculum/sharedCourseConstants';
import GetVerifiedBanner from './GetVerifiedBanner';

const COMPLETED_EVENT = 'Section Setup Completed';
const CANCELLED_EVENT = 'Section Setup Cancelled';

/**
 * UI for editing section details: Name, grade, assigned course, etc.
 */
class EditSectionForm extends Component {
  static propTypes = {
    title: PropTypes.string.isRequired,
    //Whether the user is adding a brand new section or editing an existing one.
    isNewSection: PropTypes.bool,

    //Comes from redux
    initialUnitId: PropTypes.number,
    initialCourseId: PropTypes.number,
    initialCourseOfferingId: PropTypes.number,
    initialCourseVersionId: PropTypes.number,
    courseOfferings: PropTypes.objectOf(assignmentCourseOfferingShape)
      .isRequired,
    section: sectionShape.isRequired,
    editSectionProperties: PropTypes.func.isRequired,
    handleSave: PropTypes.func.isRequired,
    handleClose: PropTypes.func.isRequired,
    isSaveInProgress: PropTypes.bool.isRequired,
    assignedUnitLessonExtrasAvailable: PropTypes.bool.isRequired,
    hiddenLessonState: PropTypes.object.isRequired,
    assignedUnitName: PropTypes.string.isRequired,
    assignedUnitTextToSpeechEnabled: PropTypes.bool.isRequired,
    updateHiddenScript: PropTypes.func.isRequired,
    localeCode: PropTypes.string,
    assignedUnitRequiresVerifiedInstructor: PropTypes.bool,
    isVerifiedInstructor: PropTypes.bool,
    showLockSectionField: PropTypes.bool // DCDO Flag - show/hide Lock Section field
  };

  state = {
    showHiddenUnitWarning: false
  };

  onCloseClick = () => {
    const {handleClose} = this.props;
    this.recordSectionSetupExitEvent(CANCELLED_EVENT);
    handleClose();
  };

  onSaveClick = () => {
    const {section, hiddenLessonState} = this.props;
    const sectionId = section.id;
    const scriptId = section.unitId;

    this.recordSectionSetupExitEvent(COMPLETED_EVENT);

    const isScriptHidden =
      sectionId &&
      scriptId &&
      isScriptHiddenForSection(hiddenLessonState, sectionId, scriptId);

    if (isScriptHidden) {
      this.setState({showHiddenUnitWarning: true});
    } else {
      this.handleSave();
    }
  };

  handleConfirmAssign = () => {
    const {section, updateHiddenScript} = this.props;

    // Avoid incorrectly showing the hidden unit warning twice.
    updateHiddenScript(section.id.toString(), section.unitId, false);

    this.setState({showHiddenUnitWarning: false});
    this.handleSave();
  };

  handleSave = () => {
    this.props.handleSave().catch(status => {
      alert(i18n.unexpectedError());
      console.error(status);
    });
  };

  recordAutoplayToggleEvent = ttsAutoplayEnabled => {
    firehoseClient.putRecord(
      {
        study: 'section_setting',
        study_group: 'tts_auto_play',
        event: ttsAutoplayEnabled ? 'turn_on' : 'turn_off',
        script_id: this.props.section.unitId,
        data_json: JSON.stringify({
          section_id: this.props.section.id
        })
      },
      {useProgressScriptId: false, includeUserId: true}
    );
  };

  recordRestrictSectionEvent = restrictSection => {
    firehoseClient.putRecord(
      {
        study: 'lock_section',
        study_group: 'display_lock_section',
        event: restrictSection ? 'turn_on' : 'turn_off',
        data_json: JSON.stringify({
          section_id: this.props.section.id
        })
      },
      {useProgressScriptId: false, includeUserId: true}
    );
  };

  // valid event names: 'Section Setup Complete', 'Section Setup Cancelled'.
  recordSectionSetupExitEvent = eventName => {
    const {
      section,
      courseOfferings,
      isNewSection,
      initialUnitId,
      initialCourseOfferingId,
      initialCourseVersionId
    } = this.props;
    const versionYear = section.courseOfferingId
      ? courseOfferings[section.courseOfferingId].course_versions[
          section.courseVersionId
        ].key
      : null;
    const initialVersionYear = initialCourseOfferingId
      ? courseOfferings[initialCourseOfferingId].course_versions[
          initialCourseVersionId
        ].key
      : null;
    const course = courseOfferings.hasOwnProperty(section.courseOfferingId)
      ? courseOfferings[section.courseOfferingId]
      : null;
    const courseName = course ? course.display_name : null;
    const courseId = course ? course.id : null;
    if (isNewSection) {
      analyticsReporter.sendEvent(eventName, {
        sectionUnitId: section.unitId,
        sectionCurriculumLocalizedName: courseName,
        sectionCurriculum: courseId, //this is course Offering id
        sectionCurriculumVersionYear: versionYear,
        sectionGrade: section.grade,
        sectionLockSelection: section.restrictSection,
        sectionName: section.name,
        sectionPairProgramSelection: section.pairingAllowed
      });
    }
    if (
      eventName === COMPLETED_EVENT &&
      ((section.courseOfferingId &&
        section.courseOfferingId !== initialCourseOfferingId) ||
        (section.unitId && section.unitId !== initialUnitId))
    ) {
      analyticsReporter.sendEvent(EVENTS.CURRICULUM_ASSIGNED, {
        sectionName: section.name,
        sectionId: section.id,
        sectionLoginType: section.loginType,
        previousUnitId: initialUnitId,
        previousCourseId: initialCourseOfferingId,
        previousCourseVersionId: initialCourseVersionId,
        previousVersionYear: initialVersionYear,
        newUnitId: section.unitId,
        newCourseId: section.courseOfferingId,
        newCourseVersionId: section.courseVersionId,
        newVersionYear: versionYear
      });
    }
  };

  render() {
    const {
      section,
      title,
      courseOfferings,
      isSaveInProgress,
      editSectionProperties,
      handleClose,
      assignedUnitLessonExtrasAvailable,
      assignedUnitTextToSpeechEnabled,
      assignedUnitRequiresVerifiedInstructor,
      assignedUnitName,
      localeCode,
      isNewSection,
      showLockSectionField,
      isVerifiedInstructor // DCDO Flag - show/hide Lock Section field
    } = this.props;

    const courseDisplayName = section.courseOfferingId
      ? courseOfferings[section.courseOfferingId].display_name
      : '';

    /**
    OAuth and personal email login types can not be changed.
    Picture login type can be changed to word login type.
    Word login type can be changed to picture login type.
    **/
    const changeableLoginTypes = [
      SectionLoginType.word,
      SectionLoginType.picture
    ];

    let sectionLoginTypeTransforms = {};
    sectionLoginTypeTransforms[SectionLoginType.email] = [
      SectionLoginType.email
    ];
    sectionLoginTypeTransforms[SectionLoginType.picture] = [
      SectionLoginType.word,
      SectionLoginType.picture
    ];
    sectionLoginTypeTransforms[SectionLoginType.word] = [
      SectionLoginType.word,
      SectionLoginType.picture
    ];
    sectionLoginTypeTransforms[SectionLoginType.clever] = [
      SectionLoginType.clever
    ];
    sectionLoginTypeTransforms[SectionLoginType.google_classroom] = [
      SectionLoginType.google_classroom
    ];

    const validLoginTypes = sectionLoginTypeTransforms[section.loginType];

    const showLoginTypeField =
      !isNewSection && changeableLoginTypes.includes(section.loginType);

    if (!section) {
      return null;
    }
    return (
      <div style={style.root}>
        <Heading1>{title}</Heading1>
        <div style={style.scroll}>
          <SectionNameField
            value={section.name}
            onChange={name => editSectionProperties({name})}
            disabled={isSaveInProgress}
          />
          {section.participantType === ParticipantAudience.student && (
            <GradeField
              value={section.grade || ''}
              onChange={grade => editSectionProperties({grade})}
              disabled={isSaveInProgress}
            />
          )}
          {showLoginTypeField && (
            <LoginTypeField
              value={section.loginType}
              onChange={loginType => editSectionProperties({loginType})}
              validLoginTypes={validLoginTypes}
              disabled={isSaveInProgress}
            />
          )}
          <AssignmentField
            section={section}
            onChange={ids => editSectionProperties(ids)}
            courseOfferings={courseOfferings}
            disabled={isSaveInProgress}
            isNewSection={isNewSection}
          />
          {!isVerifiedInstructor &&
            assignedUnitRequiresVerifiedInstructor &&
            courseDisplayName && (
              <GetVerifiedBanner courseName={courseDisplayName} />
            )}
          {assignedUnitLessonExtrasAvailable && (
            <LessonExtrasField
              value={section.lessonExtras}
              onChange={lessonExtras => editSectionProperties({lessonExtras})}
              disabled={isSaveInProgress}
            />
          )}
          <PairProgrammingField
            value={section.pairingAllowed}
            onChange={pairingAllowed => editSectionProperties({pairingAllowed})}
            disabled={isSaveInProgress}
          />
          {assignedUnitTextToSpeechEnabled && (
            <TtsAutoplayField
              isEnglish={localeCode.startsWith('en')}
              value={section.ttsAutoplayEnabled}
              onChange={ttsAutoplayEnabled => {
                editSectionProperties({ttsAutoplayEnabled});
                this.recordAutoplayToggleEvent(ttsAutoplayEnabled);
              }}
              disabled={isSaveInProgress}
            />
          )}
          {showLockSectionField && (
            <RestrictAccessField
              value={section.restrictSection}
              onChange={restrictSection => {
                editSectionProperties({restrictSection});
                this.recordRestrictSectionEvent(restrictSection);
              }}
              disabled={isSaveInProgress}
              loginType={this.props.section.loginType}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={this.onCloseClick}
            text={i18n.dialogCancel()}
            size={Button.ButtonSize.large}
            color={Button.ButtonColor.gray}
            disabled={isSaveInProgress}
            style={{margin: 0}}
          />
          <Button
            className="uitest-saveButton"
            onClick={this.onSaveClick}
            text={i18n.save()}
            size={Button.ButtonSize.large}
            color={Button.ButtonColor.orange}
            disabled={isSaveInProgress}
            style={{margin: 0}}
          />
        </DialogFooter>
        {this.state.showHiddenUnitWarning && (
          <ConfirmHiddenAssignment
            sectionName={section.name}
            assignmentName={assignedUnitName}
            onClose={handleClose}
            onConfirm={this.handleConfirmAssign}
          />
        )}
      </div>
    );
  }
}

const FieldProps = {
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool
};

const SectionNameField = ({value, onChange, disabled}) => (
  <div>
    <FieldName>{i18n.sectionName()}</FieldName>
    <FieldDescription>{i18n.addSectionName()}</FieldDescription>
    <input
      value={value}
      placeholder={i18n.addSectionNameHint()}
      onChange={event => onChange(event.target.value)}
      style={style.sectionNameInput}
      disabled={disabled}
      id="uitest-section-name"
    />
  </div>
);
SectionNameField.propTypes = FieldProps;

const GradeField = ({value, onChange, disabled}) => {
  const gradeOptions = [''].concat(StudentGradeLevels).map(grade => ({
    value: grade,
    text: grade === 'Other' ? 'Other/Mixed' : grade
  }));
  return (
    <div>
      <FieldName>{i18n.grade()}</FieldName>
      <Dropdown
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        {gradeOptions.map((grade, index) => (
          <option key={index} value={grade.value}>
            {grade.text}
          </option>
        ))}
      </Dropdown>
    </div>
  );
};
GradeField.propTypes = FieldProps;

const LoginTypeField = ({value, onChange, validLoginTypes, disabled}) => {
  const friendlyNameByLoginType = {
    [SectionLoginType.picture]: i18n.loginTypePicture(),
    [SectionLoginType.word]: i18n.loginTypeWord(),
    [SectionLoginType.email]: i18n.loginTypePersonal(),
    [SectionLoginType.google_classroom]: i18n.loginTypeGoogleClassroom(),
    [SectionLoginType.clever]: i18n.loginTypeClever()
  };
  const descriptionByLoginType = {
    [SectionLoginType.picture]: i18n.editSectionLoginTypePicDesc(),
    [SectionLoginType.word]: i18n.editSectionLoginTypeWordDesc(),
    [SectionLoginType.email]: i18n.editSectionLoginTypeEmailDesc(),
    [SectionLoginType.google_classroom]: i18n.editSectionLoginTypeGoogleDesc(),
    [SectionLoginType.clever]: i18n.editSectionLoginTypeCleverDesc()
  };

  return (
    <div>
      <FieldName>{i18n.loginType()}</FieldName>
      <Dropdown
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        {validLoginTypes.map((loginType, index) => (
          <option key={index} value={loginType}>
            {friendlyNameByLoginType[loginType]}
          </option>
        ))}
      </Dropdown>
      <span style={{marginLeft: 5}}>{descriptionByLoginType[value]}</span>
    </div>
  );
};
LoginTypeField.propTypes = {
  ...FieldProps,
  validLoginTypes: PropTypes.arrayOf(PropTypes.string).isRequired
};

const AssignmentField = ({
  section,
  onChange,
  courseOfferings,
  disabled,
  isNewSection
}) => (
  <div>
    <FieldName>{i18n.course()}</FieldName>
    <FieldDescription>
      {i18n.whichCourse()}
      <a
        href="https://support.code.org/hc/en-us/articles/204874337-What-happens-when-I-assign-a-course-to-a-section-Can-I-assign-2-at-once-"
        target="_blank"
        rel="noopener noreferrer"
      >
        {i18n.explainCourseAssignmentsLearnMore()}
      </a>
    </FieldDescription>
    <AssignmentSelector
      section={section}
      onChange={ids => onChange(ids)}
      courseOfferings={courseOfferings}
      dropdownStyle={style.dropdown}
      disabled={disabled}
      isNewSection={isNewSection}
    />
  </div>
);
AssignmentField.propTypes = {
  section: sectionShape,
  onChange: PropTypes.func.isRequired,
  courseOfferings: PropTypes.objectOf(assignmentCourseOfferingShape).isRequired,
  disabled: PropTypes.bool,
  isNewSection: PropTypes.bool
};

const LessonExtrasField = ({value, onChange, disabled}) => (
  <div>
    <FieldName>{i18n.enableLessonExtras()}</FieldName>
    <FieldDescription>
      {i18n.explainLessonExtras()}{' '}
      <a
        href="https://support.code.org/hc/en-us/articles/228116568-In-the-teacher-dashboard-what-are-stage-extras-"
        target="_blank"
        rel="noopener noreferrer"
      >
        {i18n.explainLessonExtrasLearnMore()}
      </a>
    </FieldDescription>
    <YesNoDropdown
      value={value}
      onChange={lessonExtras => onChange(lessonExtras)}
      disabled={disabled}
    />
  </div>
);
LessonExtrasField.propTypes = FieldProps;

const PairProgrammingField = ({value, onChange, disabled}) => (
  <div>
    <FieldName>{i18n.enablePairProgramming()}</FieldName>
    <FieldDescription>
      {i18n.explainPairProgramming()}{' '}
      <a
        href="https://support.code.org/hc/en-us/articles/115002122788-How-does-pair-programming-within-Code-Studio-work-"
        target="_blank"
        rel="noopener noreferrer"
      >
        {i18n.explainPairProgrammingLearnMore()}
      </a>
    </FieldDescription>
    <YesNoDropdown
      value={value}
      onChange={pairingAllowed => onChange(pairingAllowed)}
      disabled={disabled}
    />
  </div>
);
PairProgrammingField.propTypes = FieldProps;

const RestrictAccessField = ({value, onChange, disabled, loginType}) => {
  const {clever, google_classroom} = SectionLoginType;
  if (loginType !== (clever && google_classroom)) {
    return (
      <div>
        <FieldName>{i18n.restrictSectionAccess()}</FieldName>
        <FieldDescription>
          {loginType === 'email'
            ? i18n.explainRestrictedSectionEmail()
            : i18n.explainRestrictedSectionWordAndPicture()}{' '}
          <a
            href="https://support.code.org/hc/en-us/articles/360060056611"
            target="_blank"
            rel="noopener noreferrer"
          >
            {i18n.learnMore()}
          </a>
        </FieldDescription>
        <YesNoDropdown
          value={value}
          onChange={restrictSection => onChange(restrictSection)}
          disabled={disabled}
        />
      </div>
    );
  } else {
    return null;
  }
};
RestrictAccessField.propTypes = {...FieldProps, loginType: PropTypes.string};

const TtsAutoplayField = ({value, onChange, disabled, isEnglish}) => (
  <div>
    <FieldName>{i18n.enableTtsAutoplay()}</FieldName>
    <FieldDescription>
      {i18n.explainTtsAutoplay()}{' '}
      {isEnglish && (
        <a
          href="https://support.code.org/hc/en-us/articles/360058843692"
          target="_blank"
          rel="noopener noreferrer"
        >
          {'Learn more about read aloud options on Code.org.'}
        </a>
      )}
    </FieldDescription>
    <YesNoDropdown
      value={value}
      onChange={ttsAutoplayEnabled => onChange(ttsAutoplayEnabled)}
      disabled={disabled}
    />
  </div>
);
TtsAutoplayField.propTypes = {
  ...FieldProps,
  isEnglish: PropTypes.bool.isRequired
};

const FieldName = props => (
  <div
    style={{
      ...h3Style,
      marginTop: 20,
      marginBottom: 0
    }}
    {...props}
  />
);

const FieldDescription = props => (
  <div
    style={{
      marginBottom: 5
    }}
    {...props}
  />
);

const Dropdown = props => <select style={style.dropdown} {...props} />;

const YesNoDropdown = ({value, onChange, disabled}) => (
  <Dropdown
    value={value ? 'yes' : 'no'}
    onChange={event => onChange('yes' === event.target.value)}
    disabled={disabled}
  >
    <option value="yes">{i18n.yes()}</option>
    <option value="no">{i18n.no()}</option>
  </Dropdown>
);
YesNoDropdown.propTypes = FieldProps;

let defaultPropsFromState = state => ({
  initialCourseId: state.teacherSections.initialCourseId,
  initialUnitId: state.teacherSections.initialUnitId,
  initialCourseOfferingId: state.teacherSections.initialCourseOfferingId,
  initialCourseVersionId: state.teacherSections.initialCourseVersionId,
  courseOfferings: state.teacherSections.courseOfferings,
  section: state.teacherSections.sectionBeingEdited,
  isSaveInProgress: state.teacherSections.saveInProgress,
  assignedUnitLessonExtrasAvailable: assignedUnitLessonExtrasAvailable(state),
  hiddenLessonState: state.hiddenLesson,
  assignedUnitName: assignedUnitName(state),
  assignedUnitTextToSpeechEnabled: assignedUnitTextToSpeechEnabled(state),
  localeCode: state.locales.localeCode,
  assignedUnitRequiresVerifiedInstructor: assignedUnitRequiresVerifiedInstructor(
    state
  ),
  isVerifiedInstructor: state.verifiedInstructor.isVerified,

  // DCDO Flag - show/hide Lock Section field
  showLockSectionField: state.teacherSections.showLockSectionField
});

export const UnconnectedEditSectionForm = EditSectionForm;

export const ReloadAfterEditSectionForm = connect(
  defaultPropsFromState,
  {
    editSectionProperties,
    updateHiddenScript,
    handleSave: reloadAfterEditingSection,
    handleClose: cancelEditingSection
  }
)(EditSectionForm);

export default connect(
  defaultPropsFromState,
  {
    editSectionProperties,
    updateHiddenScript,
    handleSave: finishEditingSection,
    handleClose: cancelEditingSection
  }
)(EditSectionForm);

const style = {
  root: {
    width: styleConstants['content-width'],
    height: '80vh',
    left: 20,
    right: 20
  },
  dropdown: {
    padding: '0.3em'
  },
  sectionNameInput: {
    // Full-width, large happy text, lots of space.
    display: 'block',
    width: '98%',
    boxSizing: 'border-box',
    fontSize: 'large',
    padding: '0.5em'
  },
  scroll: {
    position: 'absolute',
    top: 80,
    overflowY: 'scroll',
    height: 'calc(80vh - 200px)'
  }
};
