import React, {Component} from 'react';
import PropTypes from 'prop-types';
import Button from '../Button';
import color from '../../util/color';
import {connect} from 'react-redux';
import SafeMarkdown from '@cdo/apps/templates/SafeMarkdown';

// If you want to include an image, you're probably looking for a ImageResourceCard.
class ResourceCard extends Component {
  static propTypes = {
    title: PropTypes.string.isRequired,
    callout: PropTypes.string,
    description: PropTypes.string,
    buttonText: PropTypes.string.isRequired,
    link: PropTypes.string.isRequired,
    isRtl: PropTypes.bool.isRequired,
    responsiveSize: PropTypes.string.isRequired,
    allowWrap: PropTypes.bool,
    allowMarkdown: PropTypes.bool,
    linkId: PropTypes.string,
    linkClass: PropTypes.string
  };

  render() {
    const {
      title,
      callout,
      description,
      buttonText,
      link,
      isRtl,
      allowWrap,
      allowMarkdown,
      linkId,
      linkClass,
      responsiveSize
    } = this.props;
    const localeStyle = isRtl ? styles.rtl : styles.ltr;

    const buttonStyles = styles.button;
    const cardStyles = {...styles.card, ...localeStyle};
    const titleStyles = {...styles.title, ...localeStyle};
    const descriptionStyles = {
      ...styles.text,
      ...styles.description,
      ...localeStyle
    };

    if (['sm', 'xs'].includes(responsiveSize)) {
      Object.assign(cardStyles, styles.cardSmall);
      Object.assign(titleStyles, styles.titleSmall);
      Object.assign(descriptionStyles, styles.descriptionSmall);
    }

    if (allowWrap) {
      Object.assign(buttonStyles, styles.buttonAllowWrap);
      Object.assign(cardStyles, styles.cardAllowWrap);
      Object.assign(titleStyles, styles.titleAllowWrap);
    } else {
      Object.assign(titleStyles, styles.titleNoWrap);
    }

    let descriptionContent = description;
    if (allowMarkdown) {
      descriptionContent = <SafeMarkdown markdown={description} />;
    }

    return (
      <div style={cardStyles}>
        <div style={styles.titleContainer}>
          <div style={titleStyles}>{title}</div>
          {callout && (
            <div style={styles.callout}>
              <i>{callout}</i>
            </div>
          )}
        </div>
        <div style={descriptionStyles}>{descriptionContent}</div>
        <br />
        <Button
          __useDeprecatedTag
          id={linkId}
          className={linkClass}
          href={link}
          color={Button.ButtonColor.brandSecondaryDefault}
          text={buttonText}
          style={buttonStyles}
        />
      </div>
    );
  }
}

const styles = {
  card: {
    height: 250,
    width: 308,
    background: color.neutral_light,
    border: `1px solid ${color.neutral_dark20}`
  },
  cardSmall: {
    width: '100%'
  },
  cardAllowWrap: {
    position: 'relative'
  },
  text: {
    paddingLeft: 20,
    paddingRight: 20,
    color: color.neutral_dark
  },
  titleContainer: {
    display: 'flex',
    alignItems: 'baseline',
    padding: '14px 20px 10px 20px'
  },
  title: {
    color: color.neutral_dark,
    fontFamily: '"Gotham 7r", sans-serif',
    fontSize: 27,
    lineHeight: '29px',
    boxSizing: 'border-box'
  },
  titleSmall: {
    boxSizing: 'border-box'
  },
  titleNoWrap: {
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden'
  },
  titleAllowWrap: {
    lineHeight: '1.1'
  },
  callout: {
    flex: 'none',
    fontSize: 14,
    margin: '0px 8px',
    fontFamily: '"Gotham 5r", sans-serif',
    color: color.brand_accent_default
  },
  description: {
    fontFamily: '"Gotham 4r", sans-serif',
    fontSize: 14,
    lineHeight: '21px',
    height: 140,
    marginBottom: 5,
    overflowY: 'auto'
  },
  descriptionSmall: {
    width: '100%',
    boxSizing: 'border-box'
  },
  button: {
    marginLeft: 20,
    marginRight: 20,
    whiteSpace: 'inherit'
  },
  buttonAllowWrap: {
    position: 'absolute',
    bottom: 20,
    left: 0
  },
  ltr: {
    float: 'left'
  },
  rtl: {
    float: 'right'
  }
};

export default connect(state => ({
  isRtl: state.isRtl,
  responsiveSize: state.responsive.responsiveSize
}))(ResourceCard);
