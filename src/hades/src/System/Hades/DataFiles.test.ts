import { afterEach, expect, test } from "vitest";
import { getUserName, setUserName, userNameKey } from "./DataFiles";

afterEach(() => localStorage.clear());

test("user name defaults to 'user' and can be set", () => {
  expect(getUserName()).toBe("user");
  setUserName("Paul");
  expect(localStorage.getItem(userNameKey)).toBe("Paul");
  expect(getUserName()).toBe("Paul");
  setUserName("");
  expect(localStorage.getItem(userNameKey)).toBeNull();
  expect(getUserName()).toBe("user");
});
