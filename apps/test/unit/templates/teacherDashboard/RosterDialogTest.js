import React from 'react';
import {shallow, mount} from 'enzyme';
import sinon from 'sinon';
import analyticsReporter from '@cdo/apps/lib/util/AnalyticsReporter';
import {OAuthSectionTypes} from '@cdo/apps/lib/ui/accounts/constants';
import {assert, expect} from '../../../util/reconfiguredChai';
import {UnconnectedRosterDialog as RosterDialog} from '@cdo/apps/templates/teacherDashboard/RosterDialog';
import locale from '@cdo/locale';

const failedLoadError = {
  status: 404,
  message: 'import failed'
};

const fakeClassroom = {
  id: '2',
  name: 'myClassroom',
  section: '1st Pd',
  enrollment_code: '12345'
};

describe('RosterDialog', () => {
  it('displays the loadError when there is one', () => {
    const wrapper = shallow(
      <RosterDialog
        handleImport={() => {}}
        handleCancel={() => {}}
        isOpen={true}
        classrooms={[]}
        loadError={failedLoadError}
        rosterProvider={OAuthSectionTypes.google_classroom}
      />
    );
    expect(wrapper.html()).contains(locale.authorizeGoogleClassroomsText());
  });

  it('sends cancel analytics event when dialog is canceled', () => {
    const wrapper = shallow(
      <RosterDialog
        handleImport={() => {}}
        handleCancel={() => {}}
        isOpen={true}
        classrooms={[]}
        loadError={failedLoadError}
        rosterProvider={OAuthSectionTypes.google_classroom}
      />
    );
    const analyticsSpy = sinon.spy(analyticsReporter, 'sendEvent');

    wrapper.find('button[id="cancel-button"]').simulate('click');
    assert(analyticsSpy.calledOnce);
    assert.equal(analyticsSpy.getCall(0).firstArg, 'Section Setup Cancelled');
    assert.deepEqual(analyticsSpy.getCall(0).lastArg, {
      oauthSource: OAuthSectionTypes.google_classroom
    });

    analyticsSpy.restore();
  });

  it('displays classroom options when no loadError and classrooms exist', () => {
    const wrapper = mount(
      <RosterDialog
        handleImport={() => {}}
        handleCancel={() => {}}
        isOpen={true}
        classrooms={[fakeClassroom]}
        loadError={null}
        rosterProvider={OAuthSectionTypes.google_classroom}
      />
    );
    expect(wrapper.text()).contains('myClassroom');
    expect(wrapper.text()).contains('12345');
  });

  it('sends section set up completed analytics event when import is called', () => {
    const rosterDialog = mount(
      <RosterDialog
        handleImport={() => {}}
        handleCancel={() => {}}
        isOpen={true}
        classrooms={[fakeClassroom]}
        loadError={null}
        rosterProvider={OAuthSectionTypes.google_classroom}
      />
    );
    const analyticsSpy = sinon.spy(analyticsReporter, 'sendEvent');

    rosterDialog.instance().setState({selectedId: '2'});
    rosterDialog.instance().importClassroom();
    assert(analyticsSpy.calledOnce);
    assert.equal(analyticsSpy.getCall(0).firstArg, 'Section Setup Completed');
    assert.deepEqual(analyticsSpy.getCall(0).lastArg, {
      oauthSource: OAuthSectionTypes.google_classroom
    });

    analyticsSpy.restore();
  });
});
