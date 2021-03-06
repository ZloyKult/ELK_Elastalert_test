import React from 'react';
import styled from 'styled-components';
import { withRouter } from 'react-router-dom';
import { get } from 'lodash';
import PropTypes from 'prop-types';
import { toQuery, fromQuery } from '../../../../../utils/url';
import SpanDetails from './SpanDetails';
import Modal from '../../../../shared/Modal';

import {
  unit,
  units,
  colors,
  px,
  fontFamilyCode,
  fontSizes
} from '../../../../../style/variables';
import {
  SPAN_DURATION,
  SPAN_START,
  SPAN_ID,
  SPAN_NAME
} from '../../../../../../common/constants';

const SpanBar = styled.div`
  position: relative;
  height: ${unit}px;
`;
const SpanLabel = styled.div`
  white-space: nowrap;
  position: relative;
  direction: rtl;
  text-align: left;
  margin: ${px(units.quarter)} 0 0;
  font-family: ${fontFamilyCode};
  font-size: ${fontSizes.small};
`;

const Container = styled.div`
  position: relative;
  display: block;
  user-select: none;
  padding: ${px(units.half)} ${props => px(props.timelineMargins.right)}
    ${px(units.eighth)} ${props => px(props.timelineMargins.left)};
  border-top: 1px solid ${colors.gray4};
  background-color: ${props => (props.isSelected ? colors.gray5 : 'initial')};
  cursor: pointer;
  &:hover {
    background-color: ${colors.gray5};
  }
`;

class Span extends React.Component {
  onClose = () => {
    const { location, history, match } = this.props;
    const { spanId, ...currentQuery } = toQuery(location.search);

    // TODO: This is a temporary bandaid to avoid replacing the url, after the page has changed
    // Backstory: if the modal is open, and the user clicks the back button, the modal will be destroyed,
    // and the onClose handler will fire, causing it to change the url again. This is what we want to avoid.
    const shouldReplace = window.location.href.includes(
      match.params.transactionName
    );

    if (shouldReplace) {
      history.replace({
        ...location,
        search: fromQuery({
          ...currentQuery,
          spanId: null
        })
      });
    }
  };

  updateSpanId = nextSpanId => {
    const { location, history } = this.props;
    const { spanId, ...currentQuery } = toQuery(location.search);
    history.replace({
      ...location,
      search: fromQuery({
        ...currentQuery,
        spanId: nextSpanId
      })
    });
  };

  render() {
    const {
      timelineMargins,
      totalDuration,
      span,
      spanTypes,
      color,
      isSelected,
      transactionId,
      location,
      history
    } = this.props;

    const width = get({ span }, SPAN_DURATION) / totalDuration * 100;
    const left = get({ span }, SPAN_START) / totalDuration * 100;

    const spanId = get({ span }, SPAN_ID);
    const spanName = get({ span }, SPAN_NAME);

    return (
      <Container
        onClick={() => {
          history.replace({
            ...location,
            search: fromQuery({
              ...toQuery(location.search),
              spanId
            })
          });
        }}
        timelineMargins={timelineMargins}
        isSelected={isSelected}
      >
        <SpanBar
          style={{
            left: `${left}%`,
            width: `${width}%`,
            backgroundColor: color
          }}
        />
        <SpanLabel style={{ left: `${left}%`, width: `${100 - left}%` }}>
          &lrm;{spanName}&lrm;
        </SpanLabel>

        <Modal
          header="Span details"
          isOpen={isSelected}
          onClose={this.onClose}
          close={this.onClose}
        >
          <SpanDetails
            span={span}
            spanTypes={spanTypes}
            totalDuration={totalDuration}
            transactionId={transactionId}
          />
        </Modal>
      </Container>
    );
  }
}

SpanDetails.propTypes = {
  totalDuration: PropTypes.number.isRequired
};

export default withRouter(Span);
