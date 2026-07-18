// @testing-library/react-native@13+ registers its Jest matchers (toBeOnTheScreen,
// etc.) as a side effect of importing the package root — the older
// "@testing-library/react-native/extend-expect" subpath no longer exists.
import "@testing-library/react-native";
