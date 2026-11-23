/** Reuse the live map route. In StackRouter v7, plain navigate can stack another Shift. */
export function returnToShift(navigation: { popTo(name: 'Shift'): void }): void {
  navigation.popTo('Shift');
}
