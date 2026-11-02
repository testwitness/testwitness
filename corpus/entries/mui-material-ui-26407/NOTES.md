# mui/material-ui#26407

ClockPicker tests that lived in MobileTimePicker.test.tsx are moved to ClockPicker.test.tsx and rewritten to render ClockPicker directly, with the conditional this.skip hook travelling with them and extra assertions added. Honest move. Stresses move detection when the body is adapted and conditional skip hooks appear in a new file.
