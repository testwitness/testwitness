# microsoft/react-native-test-app#2696

Makes the Windows build jobs non-blocking with continue-on-error and adds a job that aggregates their results as warnings. The jobs build the example app; they run no tests. Honest control for W002 on a build job.
