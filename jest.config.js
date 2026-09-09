/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/{scripts,test}/**/*.spec.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
        diagnostics: true,
      },
    ],
  },
  collectCoverageFrom: ["<rootDir>/src/**/*.ts", "<rootDir>/scripts/**/*.ts"],
  coverageDirectory: "coverage",
};
