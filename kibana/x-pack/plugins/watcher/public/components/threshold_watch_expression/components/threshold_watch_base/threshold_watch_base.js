import { InitAfterBindingsWorkaround } from 'ui/compat';
import { forEach, size } from 'lodash';

export class ThresholdWatchBaseController extends InitAfterBindingsWorkaround {
  checkValidity = () => {
    if (this.isValid()) {
      this.onValid(this.itemId);
    } else {
      this.onInvalid(this.itemId);
    }
  }

  checkDirty = () => {
    if (this.form.$dirty) {
      this.onDirty(this.itemId);
    } else {
      this.onPristine(this.itemId);
    }
  }

  resetForm = () => {
    // https://stackoverflow.com/a/31012711
    forEach(this.form, (control) => {
      if (Boolean(control) && typeof control.$setViewValue === 'function') {
        control.$setViewValue(undefined);
      }
    });

    this.form.$setPristine();
    this.form.$setUntouched();
  }

  isValid = () => {
    return !(this.form.$invalid);
  }

  isDirty = () => {
    return this.form.$dirty;
  }

  isValidationMessageVisible = (fieldName, errorType, showIfOtherErrors = true) => {
    let showMessage = this.form[fieldName] &&
      (this.form[fieldName].$touched || this.form[fieldName].$dirty) &&
      this.form[fieldName].$error[errorType];

    if (showMessage && !showIfOtherErrors && size(this.form[fieldName].$error) > 1) {
      showMessage = false;
    }

    return showMessage;
  }
}
