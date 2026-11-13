import { describe, it, expect } from 'vitest';
import type { FrameworkProfile, TestInventory, TestCase } from '@testwitness/core';
import { javaFrontEnd, buildJavaInventory } from './index.js';
import type { JavaTestTiming } from './index.js';
const TIMING_OFF = process.env['TESTWITNESS_TIMING'] === 'off'; // Stryker instruments the code under test, so wall clock budgets do not apply there

const profile: FrameworkProfile = { frameworks: new Set(), extraAssertions: [] };

async function inv(source: string, path = 'src/test/java/com/acme/FooTest.java', p: FrameworkProfile = profile): Promise<TestInventory> {
  return javaFrontEnd.inventory(path, source, p);
}

async function one(source: string, path?: string, p?: FrameworkProfile): Promise<TestCase> {
  const i = await inv(source, path, p);
  expect(i.tests.length).toBe(1);
  return i.tests[0]!;
}

async function timingOf(source: string): Promise<JavaTestTiming[]> {
  const { timing } = await buildJavaInventory('src/test/java/FooTest.java', source, profile);
  return timing;
}

const JUNIT5_HEADER = `package com.acme;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;
`;

const JUNIT4_HEADER = `package com.acme;
import org.junit.Test;
import org.junit.Ignore;
import static org.junit.Assert.*;
`;

const TESTNG_HEADER = `package com.acme;
import org.testng.annotations.Test;
import org.testng.annotations.DataProvider;
import static org.testng.Assert.*;
`;

describe('test discovery', () => {
  it('finds a plain JUnit 5 test with Class#method qualified name', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test
  void adds() { assertEquals(2, calc.add(1, 1)); }
}`);
    expect(t.name).toBe('adds');
    expect(t.qualifiedName).toBe('FooTest#adds');
    expect(t.container).toEqual(['FooTest']);
    expect(t.framework).toBe('junit5');
    expect(t.startLine).toBe(10);
    expect(t.endLine).toBe(11);
  });

  it('builds Outer$Inner#method names for @Nested classes', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class BillingTest {
  @Test void top() { assertTrue(true); }
  @Nested
  class WhenExpired {
    @Test void rejects() { assertFalse(card.ok()); }
    @Nested class Deep { @Test void deeper() { assertNotNull(x); } }
  }
}`);
    const names = i.tests.map((t) => t.qualifiedName);
    expect(names).toEqual(['BillingTest#top', 'BillingTest$WhenExpired#rejects', 'BillingTest$WhenExpired$Deep#deeper']);
    expect(i.tests[2]!.container).toEqual(['BillingTest', 'WhenExpired', 'Deep']);
  });

  it('ignores methods without a test annotation', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @Test void a() { assertTrue(x); }
  void notATest() { assertTrue(y); }
  public static void main(String[] args) {}
}`);
    expect(i.tests.map((t) => t.name)).toEqual(['a']);
  });

  it('accepts fully qualified annotations and detects the framework from them', async () => {
    const i = await inv(`package com.acme;
class FooTest {
  @org.junit.jupiter.api.Test
  void a() { org.junit.jupiter.api.Assertions.assertEquals(1, 1); }
}`);
    expect(i.framework).toBe('junit5');
    expect(i.tests[0]!.qualifiedName).toBe('FooTest#a');
    expect(i.tests[0]!.assertions[0]!.callee).toBe('assertEquals');
  });

  it('counts @ParameterizedTest, @RepeatedTest, @TestFactory and @TestTemplate as tests', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.TestTemplate;
class FooTest {
  @ParameterizedTest @ValueSource(ints = {1, 2}) void p(int i) { assertTrue(i > 0); }
  @RepeatedTest(3) void r() { assertTrue(true); }
  @TestFactory Stream<DynamicTest> f() { return Stream.of(); }
  @TestTemplate void t() { }
}`);
    expect(i.tests.map((t) => t.name)).toEqual(['p', 'r', 'f', 't']);
    expect(i.tests[1]!.parameterCount).toBe(3);
  });

  it('drops abstract methods even when annotated', async () => {
    const i = await inv(`${JUNIT5_HEADER}
abstract class ContractTest {
  @Test abstract void mustImplement();
  @Test void concrete() { assertTrue(true); }
}`);
    expect(i.tests.map((t) => t.name)).toEqual(['concrete']);
  });

  it('counts interface default methods annotated with @Test', async () => {
    const t = await one(`${JUNIT5_HEADER}
interface ComparableContract<T> {
  T createValue();
  @Test
  default void returnsZeroWhenComparedToItself() {
    T value = createValue();
    assertEquals(0, value.compareTo(value));
  }
}`);
    expect(t.qualifiedName).toBe('ComparableContract#returnsZeroWhenComparedToItself');
    expect(t.assertions).toHaveLength(1);
  });

  it('ignores methods inside anonymous classes', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @Test void a() {
    Runnable r = new Runnable() { @Test public void run() { assertTrue(true); } };
    assertNotNull(r);
  }
}`);
    expect(i.tests.map((t) => t.name)).toEqual(['a']);
    expect(i.tests[0]!.assertions.map((a) => a.callee)).toEqual(['assertTrue', 'assertNotNull']);
  });

  it('counts assertions inside an anonymous class method declared in the test body', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void dumps() {
    Writer w = new StringWriter() {
      @Override public void write(String s) { assertEquals("x", s); }
    };
    dump(w);
  }
}`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertEquals']);
  });

  it('counts assertions inside a lambda body that is not an assertion argument', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void listens() {
    bus.subscribe(event -> { assertEquals("x", event.name()); });
    bus.publish(new Event("x"));
  }
}`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertEquals']);
  });

  it('counts assertions inside a local class method', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void local() {
    class Check { void run(int n) { assertTrue(n > 0); } }
    new Check().run(compute());
  }
}`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertTrue']);
  });

  it('TestNG class level @Test makes public methods tests', async () => {
    const i = await inv(`${TESTNG_HEADER}
@Test
public class FooTest {
  public void a() { assertEquals(calc.add(1, 1), 2); }
  private void helper() { assertTrue(true); }
  @BeforeMethod public void setUp() {}
  public static void util() {}
}`);
    expect(i.framework).toBe('testng');
    expect(i.tests.map((t) => t.name)).toEqual(['a']);
    expect(i.assertionHelpers).toEqual(new Set(['helper']));
  });
});

describe('framework detection', () => {
  it('detects junit4 from org.junit.Test import', async () => {
    const i = await inv(`${JUNIT4_HEADER}
public class FooTest { @Test public void a() { assertEquals(1, 1); } }`);
    expect(i.framework).toBe('junit4');
    expect(i.tests[0]!.framework).toBe('junit4');
  });

  it('detects junit5 from a static jupiter import alone', async () => {
    const i = await inv(`import static org.junit.jupiter.api.Assertions.assertEquals;
class FooTest { @Test void a() { assertEquals(1, 1); } }`);
    expect(i.framework).toBe('junit5');
  });

  it('detects testng from org.testng imports', async () => {
    const i = await inv(`${TESTNG_HEADER}
public class FooTest { @Test public void a() { assertEquals(1, 1); } }`);
    expect(i.framework).toBe('testng');
  });

  it('falls back to the profile, then to junit5', async () => {
    const src = `class FooTest { @Test void a() { assertEquals(1, 1); } }`;
    const a = await inv(src, undefined, { frameworks: new Set(['testng']), extraAssertions: [] });
    expect(a.framework).toBe('testng');
    const b = await inv(src);
    expect(b.framework).toBe('junit5');
  });

  it('records imports including static ones', async () => {
    const i = await inv(`${JUNIT5_HEADER}class FooTest {}`);
    expect(i.imports).toContain('org.junit.jupiter.api.Test');
    expect(i.imports).toContain('static org.junit.jupiter.api.Assertions.*');
  });
});

describe('assertions', () => {
  it('assertEquals uses the actual (second) argument as subject', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { assertEquals(42, service.compute(x)); } }`);
    const a = t.assertions[0]!;
    expect(a.callee).toBe('assertEquals');
    expect(a.subject).toBe('service.compute(x)');
    expect(a.kind).toBe('value');
    expect(a.family).toBe('junit');
    expect(a.strength).toBe(4);
    expect(a.text).toBe('assertEquals(42, service.compute(x));');
  });

  it('strips the trailing message in JUnit 5 and the leading message in JUnit 4', async () => {
    const t5 = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { assertEquals(1, actual, "should match"); } }`);
    expect(t5.assertions[0]!.subject).toBe('actual');
    const t4 = await one(`${JUNIT4_HEADER}
public class FooTest { @Test public void a() { assertEquals("should match", 1, actual); assertTrue("msg", flag); } }`);
    expect(t4.assertions[0]!.subject).toBe('actual');
    expect(t4.assertions[1]!.subject).toBe('flag');
  });

  it('TestNG Assert.assertEquals(actual, expected) uses the first argument', async () => {
    const t = await one(`${TESTNG_HEADER}
public class FooTest { @Test public void a() { assertEquals(result.size(), 3); } }`);
    expect(t.assertions[0]!.subject).toBe('result.size()');
    expect(t.assertions[0]!.family).toBe('testng');
  });

  it('classifies assertNotNull, assertDoesNotThrow and instanceof checks as smoke', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() {
  assertNotNull(x);
  assertDoesNotThrow(() -> svc.run());
  assertTrue(x instanceof Foo);
  assertInstanceOf(Foo.class, x);
} }`);
    expect(t.assertions.map((a) => a.kind)).toEqual(['smoke', 'smoke', 'smoke', 'smoke']);
    expect(t.assertions.map((a) => a.strength)).toEqual([1, 1, 1, 1]);
  });

  it('assertThrows is an exception assertion with the lambda as subject', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() {
  IllegalStateException e = assertThrows(IllegalStateException.class, () -> svc.fail(1));
  assertEquals("boom", e.getMessage());
} }`);
    expect(t.assertions).toHaveLength(2);
    expect(t.assertions[0]).toMatchObject({ callee: 'assertThrows', kind: 'exception', subject: '() -> svc.fail(1)', strength: 3 });
    expect(t.statementCount).toBe(2);
  });

  it('assertAll counts once and its nested assertions count too', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() {
  assertAll("person",
    () -> assertEquals("Jane", p.first()),
    () -> assertEquals("Doe", p.last()));
} }`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertAll', 'assertEquals', 'assertEquals']);
    expect(t.statementCount).toBe(1);
  });

  it('AssertJ chains give assertThat.<terminal> with the subject of assertThat', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.assertj.core.api.Assertions.assertThat;
class FooTest { @Test void a() {
  assertThat(repo.findAll()).as("all rows").hasSize(3);
  assertThat(name).isEqualTo("x");
  assertThat(obj).isNotNull();
  assertThat(list).isNotNull().containsExactly(1, 2);
} }`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertThat.hasSize', 'assertThat.isEqualTo', 'assertThat.isNotNull', 'assertThat.containsExactly']);
    expect(t.assertions[0]!.subject).toBe('repo.findAll()');
    expect(t.assertions[0]!.kind).toBe('value');
    expect(t.assertions[1]).toMatchObject({ subject: 'name', family: 'assertj', strength: 4, kind: 'value' });
    expect(t.assertions[2]).toMatchObject({ kind: 'smoke', strength: 1 });
    expect(t.assertions[3]).toMatchObject({ kind: 'state', strength: 4 });
  });

  it('AssertJ exception shapes are exception assertions', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.assertj.core.api.Assertions.*;
class FooTest { @Test void a() {
  assertThatThrownBy(() -> svc.fail()).isInstanceOf(IllegalStateException.class).hasMessage("boom");
  assertThatCode(() -> svc.ok()).doesNotThrowAnyException();
  assertThatExceptionOfType(IOException.class).isThrownBy(() -> io.read());
} }`);
    expect(t.assertions[0]).toMatchObject({ callee: 'assertThatThrownBy.hasMessage', kind: 'exception', strength: 4 });
    expect(t.assertions[1]).toMatchObject({ callee: 'assertThatCode.doesNotThrowAnyException', kind: 'smoke', strength: 1 });
    expect(t.assertions[2]).toMatchObject({ callee: 'assertThatExceptionOfType.isThrownBy', kind: 'exception' });
  });

  it('Hamcrest assertThat(actual, matcher) reads the matcher for strength', async () => {
    const t = await one(`${JUNIT4_HEADER}
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.*;
public class FooTest { @Test public void a() {
  assertThat(result, is(equalTo(5)));
  assertThat(result, notNullValue());
  assertThat("reason", items, hasSize(2));
} }`);
    expect(t.assertions[0]).toMatchObject({ callee: 'assertThat.equalTo', subject: 'result', family: 'hamcrest', strength: 4, kind: 'value' });
    expect(t.assertions[1]).toMatchObject({ callee: 'assertThat.notNullValue', kind: 'smoke', strength: 1 });
    expect(t.assertions[2]).toMatchObject({ callee: 'assertThat.hasSize', subject: 'items', kind: 'state', strength: 3 });
  });

  it('Truth chains are family truth when only Truth is imported', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static com.google.common.truth.Truth.assertThat;
import static com.google.common.truth.Truth.assertWithMessage;
class FooTest { @Test void a() {
  assertThat(list).containsExactly(1, 2).inOrder();
  assertWithMessage("size").that(list.size()).isEqualTo(2);
} }`);
    expect(t.assertions[0]).toMatchObject({ callee: 'assertThat.containsExactly', family: 'truth', strength: 4 });
    expect(t.assertions[1]).toMatchObject({ callee: 'assertWithMessage.isEqualTo', subject: 'list.size()', family: 'truth', strength: 4 });
  });

  it('Mockito verify is an interaction assertion with the mode setting strength', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.mockito.Mockito.*;
class FooTest { @Test void a() {
  verify(billing).charge(10);
  verify(billing, times(2)).charge(anyInt());
  verify(billing, never()).refund(any());
  Mockito.verifyNoMoreInteractions(billing);
  InOrder inOrder = inOrder(a, b);
  inOrder.verify(a).first();
} }`);
    const [v1, v2, v3, v4, v5] = t.assertions;
    expect(v1).toMatchObject({ callee: 'verify', subject: 'billing', kind: 'interaction', family: 'mockito', strength: 3 });
    expect(v2).toMatchObject({ strength: 4 });
    expect(v3).toMatchObject({ strength: 3 });
    expect(v4).toMatchObject({ callee: 'verifyNoMoreInteractions', kind: 'interaction' });
    expect(v5).toMatchObject({ callee: 'inOrder.verify', subject: 'a', kind: 'interaction' });
    expect(t.assertions).toHaveLength(5);
  });

  it('BDDMockito then(mock).should() is an interaction assertion', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.mockito.BDDMockito.*;
class FooTest { @Test void a() { then(billing).should(times(1)).charge(10); } }`);
    expect(t.assertions[0]).toMatchObject({ callee: 'then.should', kind: 'interaction', subject: 'billing', strength: 4 });
  });

  it('Spring MockMvc andExpect gives one assertion per expectation', async () => {
    const t = await one(`${JUNIT5_HEADER}
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class FooTest { @Test void a() throws Exception {
  mockMvc.perform(get("/api/x"))
    .andExpect(status().isOk())
    .andExpect(jsonPath("$.id").value(1))
    .andExpect(content().string("ok"));
} }`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['andExpect.status.isOk', 'andExpect.jsonPath.value', 'andExpect.content.string']);
    expect(t.assertions.map((a) => a.strength)).toEqual([2, 4, 4]);
    expect(t.assertions[0]!.family).toBe('spring');
    expect(t.assertions[0]!.subject).toBe('mockMvc.perform(get("/api/x"))');
  });

  it('REST Assured then() terminals are assertions', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
class FooTest { @Test void a() {
  given().when().get("/users/1").then().statusCode(200).body("name", equalTo("jane"));
} }`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['then.statusCode', 'then.body']);
    expect(t.assertions[0]!.family).toBe('restassured');
  });

  it('Awaitility untilAsserted is an assertion and nested assertions still count', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.awaitility.Awaitility.await;
import static org.assertj.core.api.Assertions.assertThat;
class FooTest { @Test void a() {
  await().atMost(5, SECONDS).untilAsserted(() -> assertThat(queue.size()).isEqualTo(0));
  await().until(() -> done.get());
} }`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['await.untilAsserted', 'assertThat.isEqualTo', 'await.until']);
    expect(t.assertions[0]!.family).toBe('awaitility');
  });

  it('@Test(expected = X.class) is an exception assertion', async () => {
    const t = await one(`${JUNIT4_HEADER}
public class FooTest {
  @Test(expected = IllegalArgumentException.class)
  public void rejects() { svc.call(null); }
}`);
    expect(t.assertions).toHaveLength(1);
    expect(t.assertions[0]).toMatchObject({ callee: '@Test(expected)', subject: 'IllegalArgumentException', kind: 'exception' });
  });

  it('TestNG expectedExceptions is an exception assertion', async () => {
    const t = await one(`${TESTNG_HEADER}
public class FooTest {
  @Test(expectedExceptions = { IOException.class, IllegalStateException.class })
  public void rejects() { svc.call(null); }
}`);
    expect(t.assertions[0]).toMatchObject({ callee: '@Test(expectedExceptions)', subject: 'IOException, IllegalStateException', kind: 'exception' });
  });

  it('custom helpers in the same file are custom assertions and are listed in assertionHelpers', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @Test void a() { Result r = svc.run(); assertValid(r); this.assertValid(r); }
  private void assertValid(Result r) { assertNotNull(r); assertTrue(r.ok()); }
  private void noAssertions(Result r) { System.out.println(r); }
}`);
    expect(i.assertionHelpers).toEqual(new Set(['assertValid']));
    const t = i.tests[0]!;
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertValid', 'this.assertValid']);
    expect(t.assertions[0]).toMatchObject({ kind: 'custom', subject: 'r' });
    expect(t.assertions[0]!.family).toBeUndefined();
  });

  it('profile.extraAssertions are custom assertions', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { MyAsserts.assertValid(r); checkIt(r); } }`, undefined, { frameworks: new Set(), extraAssertions: ['MyAsserts.assertValid', 'checkIt'] });
    expect(t.assertions.map((a) => a.callee)).toEqual(['MyAsserts.assertValid', 'checkIt']);
    expect(t.assertions.every((a) => a.kind === 'custom')).toBe(true);
  });

  it('lifecycle methods with assertions are not helpers', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import org.junit.jupiter.api.BeforeEach;
class FooTest {
  @BeforeEach void setUp() { assertNotNull(svc); }
  @Test void a() { assertTrue(true); }
}`);
    expect(i.assertionHelpers.size).toBe(0);
  });

  it('the Java assert statement is recorded as a bare assertion', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { assert x > 0; } }`);
    expect(t.assertions[0]).toMatchObject({ callee: 'assert', subject: 'x > 0', kind: 'value' });
  });

  it('non assertion calls are not assertions', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { svc.run(); log.info("x"); when(mock.get()).thenReturn(1); given(x).willReturn(2); } }`);
    expect(t.assertions).toEqual([]);
  });
});

describe('expected operand', () => {
  it('assertEquals expected is the first argument, TestNG the second', async () => {
    const t5 = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { assertEquals(42, actual); assertThrows(IOException.class, () -> io.read()); assertNotNull(x); } }`);
    expect(t5.assertions[0]!.expected).toBe('42');
    expect(t5.assertions[1]!.expected).toBe('IOException');
    expect(t5.assertions[2]!.expected).toBeUndefined();
    const ng = await one(`${TESTNG_HEADER}
public class FooTest { @Test public void a() { assertEquals(actual, 42); } }`);
    expect(ng.assertions[0]!.expected).toBe('42');
  });

  it('AssertJ, Hamcrest, Spring and REST Assured carry the matcher argument as expected', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.*;
class FooTest { @Test void a() throws Exception {
  assertThat(name).isEqualTo("jane");
  assertThat(obj).isNotNull();
  assertThat(count, is(equalTo(5)));
  mockMvc.perform(get("/x")).andExpect(status().isOk());
  given().when().get("/u").then().statusCode(200);
} }`);
    expect(t.assertions.map((a) => a.expected)).toEqual(['"jane"', undefined, 'is(equalTo(5))', 'status().isOk()', '200']);
  });
});

describe('markers', () => {
  it('@Disabled with a reason is a constant skip', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Disabled("flaky, see #123") @Test void a() { assertTrue(true); } }`);
    expect(t.markers).toEqual([{ marker: '@Disabled', kind: 'skip', constant: true, reason: 'flaky, see #123', line: 9 }]);
  });

  it('class level @Disabled applies to every method and is a file marker', async () => {
    const i = await inv(`${JUNIT5_HEADER}
@Disabled
class FooTest {
  @Test void a() { assertTrue(true); }
  @Nested class In { @Test void b() { assertTrue(true); } }
}`);
    expect(i.tests).toHaveLength(2);
    for (const t of i.tests) expect(t.markers.map((m) => m.marker)).toEqual(['@Disabled']);
    expect(i.fileMarkers.map((m) => m.marker)).toEqual(['@Disabled']);
  });

  it('@DisabledOnOs and friends are conditional skips without constant', async () => {
    const t = await one(`${JUNIT5_HEADER}
import org.junit.jupiter.api.condition.*;
class FooTest { @Test @DisabledOnOs(OS.WINDOWS) @DisabledIfSystemProperty(named = "ci", matches = "true", disabledReason = "slow") void a() { } }`);
    expect(t.markers).toEqual([
      { marker: '@DisabledOnOs', kind: 'conditional-skip', line: 10 },
      { marker: '@DisabledIfSystemProperty', kind: 'conditional-skip', reason: 'slow', line: 10 },
    ]);
  });

  it('@EnabledIf("false") and @DisabledIf("true") fold to constant', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @Test @EnabledIf("false") void a() { }
  @Test @DisabledIf("true") void b() { }
  @Test @EnabledIf("isCi") void c() { }
}`);
    expect(i.tests[0]!.markers[0]).toMatchObject({ marker: '@EnabledIf', kind: 'conditional-skip', constant: true });
    expect(i.tests[1]!.markers[0]).toMatchObject({ marker: '@DisabledIf', kind: 'conditional-skip', constant: true });
    expect(i.tests[2]!.markers[0]!.constant).toBeUndefined();
  });

  it('JUnit 4 @Ignore is a skip', async () => {
    const t = await one(`${JUNIT4_HEADER}
public class FooTest { @Ignore @Test public void a() { } }`);
    expect(t.markers[0]).toMatchObject({ marker: '@Ignore', kind: 'skip', constant: true });
  });

  it('TestNG @Test(enabled = false) is a constant skip and a flag is conditional', async () => {
    const i = await inv(`${TESTNG_HEADER}
public class FooTest {
  @Test(enabled = false) public void a() { }
  @Test(enabled = RUN_SLOW) public void b() { }
  @Test(enabled = true) public void c() { }
}`);
    expect(i.tests[0]!.markers[0]).toMatchObject({ marker: '@Test(enabled=false)', kind: 'skip', constant: true });
    expect(i.tests[1]!.markers[0]).toMatchObject({ marker: '@Test(enabled=)', kind: 'conditional-skip' });
    expect(i.tests[2]!.markers).toEqual([]);
  });

  it('assumeTrue(false), assumeFalse(true) and Assumptions.abort() as first statement are skips', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import static org.junit.jupiter.api.Assumptions.*;
class FooTest {
  @Test void a() { assumeTrue(false); assertTrue(true); }
  @Test void b() { assumeFalse(true, "not yet"); }
  @Test void c() { Assumptions.abort("skipping"); }
  @Test void d() { assumeTrue(System.getenv("CI") == null); assertTrue(true); }
  @Test void e() { assertTrue(true); assumeTrue(false); }
}`);
    expect(i.tests[0]!.markers[0]).toMatchObject({ marker: 'assumeTrue(false)', kind: 'skip', constant: true });
    expect(i.tests[1]!.markers[0]).toMatchObject({ marker: 'assumeFalse(true)', kind: 'skip', constant: true, reason: 'not yet' });
    expect(i.tests[2]!.markers[0]).toMatchObject({ marker: 'Assumptions.abort', kind: 'skip', constant: true, reason: 'skipping' });
    expect(i.tests[3]!.markers[0]).toMatchObject({ marker: 'assumeTrue', kind: 'conditional-skip' });
    expect(i.tests[3]!.markers[0]!.constant).toBeUndefined();
    expect(i.tests[4]!.markers).toEqual([]);
  });

  it('TestNG throw new SkipException as first statement is a skip', async () => {
    const t = await one(`${TESTNG_HEADER}
import org.testng.SkipException;
public class FooTest { @Test public void a() { throw new SkipException("later"); } }`);
    expect(t.markers[0]).toMatchObject({ marker: 'throw new SkipException', kind: 'skip', constant: true, reason: 'later' });
  });

  it('JUnit 4 @Test(expected = AssertionError.class) is an xfail marker and still an exception assertion', async () => {
    const i = await inv(`${JUNIT4_HEADER}
import org.junit.ComparisonFailure;
public class FooTest {
  @Test(expected = AssertionError.class) public void a() { assertEquals(1, svc.call()); }
  @Test(expected = ComparisonFailure.class) public void b() { assertEquals("x", svc.name()); }
  @Test(expected = IllegalArgumentException.class) public void c() { svc.call(null); }
}`);
    expect(i.tests[0]!.markers).toEqual([{ marker: '@Test(expected=AssertionError)', kind: 'xfail', constant: true, line: 8 }]);
    expect(i.tests[0]!.assertions.map((a) => a.callee).sort()).toEqual(['@Test(expected)', 'assertEquals']);
    expect(i.tests[1]!.markers[0]).toMatchObject({ kind: 'xfail', marker: '@Test(expected=ComparisonFailure)' });
    expect(i.tests[2]!.markers).toEqual([]);
  });

  it('TestNG expectedExceptions containing AssertionError is an xfail marker', async () => {
    const i = await inv(`${TESTNG_HEADER}
public class FooTest {
  @Test(expectedExceptions = { IOException.class, AssertionError.class }) public void a() { svc.call(null); }
  @Test(expectedExceptions = IllegalStateException.class) public void b() { svc.call(null); }
}`);
    expect(i.tests[0]!.markers[0]).toMatchObject({ kind: 'xfail', marker: '@Test(expectedExceptions=AssertionError)', constant: true });
    expect(i.tests[1]!.markers).toEqual([]);
  });

  it('@Test(expected = X.class) carries no expected operand, so it never reads as a tautology', async () => {
    const t = await one(`${JUNIT4_HEADER}
public class FooTest {
  @Test(expected = IllegalArgumentException.class)
  public void rejects() { svc.call(null); }
}`);
    expect(t.assertions[0]!.subject).toBe('IllegalArgumentException');
    expect(t.assertions[0]!.expected).toBeUndefined();
  });
});

describe('parameter counts', () => {
  it('counts @ValueSource literals', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @ParameterizedTest @ValueSource(ints = {1, 2, 3}) void a(int i) { }
  @ParameterizedTest @ValueSource(strings = "only") void b(String s) { }
}`);
    expect(i.tests[0]!.parameterCount).toBe(3);
    expect(i.tests[1]!.parameterCount).toBe(1);
  });

  it('counts @CsvSource rows including text blocks', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import org.junit.jupiter.params.provider.CsvSource;
class FooTest {
  @ParameterizedTest @CsvSource({"a, 1", "b, 2"}) void a(String s, int i) { }
  @ParameterizedTest @CsvSource(textBlock = """
      # header comment
      a, 1
      b, 2
      c, 3
      """) void b(String s, int i) { }
}`);
    expect(i.tests[0]!.parameterCount).toBe(2);
    expect(i.tests[1]!.parameterCount).toBe(3);
  });

  it('@EnumSource with names is countable, without names it is not', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import org.junit.jupiter.params.provider.EnumSource;
class FooTest {
  @ParameterizedTest @EnumSource(value = Color.class, names = {"RED", "GREEN"}) void a(Color c) { }
  @ParameterizedTest @EnumSource(Color.class) void b(Color c) { }
}`);
    expect(i.tests[0]!.parameterCount).toBe(2);
    expect(i.tests[1]!.parameterCount).toBeUndefined();
  });

  it('@MethodSource and TestNG @DataProvider are undefined, @NullAndEmptySource adds two', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import org.junit.jupiter.params.provider.*;
class FooTest {
  @ParameterizedTest @MethodSource("cases") void a(String s) { }
  @ParameterizedTest @NullAndEmptySource @ValueSource(strings = {"x"}) void b(String s) { }
  @Test void c() { }
}`);
    expect(i.tests[0]!.parameterCount).toBeUndefined();
    expect(i.tests[1]!.parameterCount).toBe(3);
    expect(i.tests[2]!.parameterCount).toBeUndefined();
    const ng = await inv(`${TESTNG_HEADER}
public class FooTest {
  @DataProvider(name = "d") public Object[][] d() { return new Object[][] {{1}, {2}}; }
  @Test(dataProvider = "d") public void a(int i) { assertTrue(i > 0); }
}`);
    expect(ng.tests).toHaveLength(1);
    expect(ng.tests[0]!.parameterCount).toBeUndefined();
  });
});

describe('mocks', () => {
  it('collects @Mock, @MockBean, @MockitoBean fields and @Spy as partial', async () => {
    const t = await one(`${JUNIT5_HEADER}
import org.mockito.Mock;
import org.mockito.Spy;
import org.springframework.boot.test.mock.mockito.MockBean;
class FooTest {
  @Mock BillingService billing;
  @MockBean private Mailer mailer;
  @MockitoBean Clock clock;
  @Spy Ledger ledger;
  @InjectMocks Checkout checkout;
  @Test void a() { assertTrue(true); }
}`);
    expect(t.mocks).toEqual(['BillingService', 'Mailer', 'Clock', 'spy:Ledger']);
  });

  it('collects mock(X.class), Mockito.mock, mockStatic and spy in the body', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.mockito.Mockito.*;
class FooTest { @Test void a() {
  Foo f = mock(Foo.class);
  Bar b = Mockito.mock(Bar.class, withSettings());
  try (MockedStatic<Util> u = mockStatic(Util.class)) { }
  Baz z = spy(new Baz());
  Foo again = mock(Foo.class);
  other.mock(Qux.class);
} }`);
    expect(t.mocks).toEqual(['Foo', 'Bar', 'Util', 'spy:new Baz()']);
  });

  it('outer class mocks apply to nested class tests', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @Mock Repo repo;
  @Nested class In { @Mock Clock clock; @Test void b() { } }
}`);
    expect(i.tests[0]!.mocks).toEqual(['Repo', 'Clock']);
  });
});

describe('timing signals', () => {
  it('reads @Timeout, @Test(timeout=) and TestNG timeOut', async () => {
    const t5 = await timingOf(`${JUNIT5_HEADER}
import org.junit.jupiter.api.Timeout;
class FooTest {
  @Test @Timeout(5) void a() { }
  @Test @Timeout(value = 200, unit = TimeUnit.MILLISECONDS) void b() { }
  @Test void c() { }
}`);
    expect(t5[0]).toMatchObject({ timeoutMs: 5000, timeoutSource: '@Timeout' });
    expect(t5[1]).toMatchObject({ timeoutMs: 200 });
    expect(t5[2]!.timeoutMs).toBeUndefined();
    const t4 = await timingOf(`${JUNIT4_HEADER}
public class FooTest { @Test(timeout = 500) public void a() { } }`);
    expect(t4[0]).toMatchObject({ timeoutMs: 500, timeoutSource: '@Test(timeout)' });
    const ng = await timingOf(`${TESTNG_HEADER}
public class FooTest { @Test(timeOut = 1000) public void a() { } }`);
    expect(ng[0]).toMatchObject({ timeoutMs: 1000, timeoutSource: '@Test(timeOut)' });
  });

  it('records Thread.sleep, TimeUnit sleeps and Awaitility awaits', async () => {
    const [t] = await timingOf(`${JUNIT5_HEADER}
import static org.awaitility.Awaitility.await;
class FooTest { @Test void a() throws Exception {
  Thread.sleep(1500);
  TimeUnit.SECONDS.sleep(2);
  SECONDS.sleep(1);
  Thread.sleep(delay);
  await().atMost(5, SECONDS).until(() -> done.get());
} }`);
    expect(t!.sleeps.map((s) => [s.callee, s.ms])).toEqual([
      ['Thread.sleep', 1500],
      ['TimeUnit.SECONDS.sleep', 2000],
      ['SECONDS.sleep', 1000],
      ['Thread.sleep', undefined],
    ]);
    expect(t!.sleeps[0]!.text).toBe('Thread.sleep(1500);');
    expect(t!.awaits).toBe(1);
  });
});

describe('body hash and statement count', () => {
  it('bodyHash ignores the name, whitespace and comments', async () => {
    const a = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { assertEquals(1, x); } }`);
    const b = await one(`${JUNIT5_HEADER}
class FooTest { @Test void renamed() {
  // a comment
  assertEquals(1,   x); /* more */
} }`);
    expect(a.bodyHash).toBe(b.bodyHash);
    expect(a.bodyHash).toMatch(/^[0-9a-f]{16}$/);
    const c = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() { assertEquals(2, x); } }`);
    expect(c.bodyHash).not.toBe(a.bodyHash);
  });

  it('statementCount excludes bare return, string statements, empty statements and comments', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void a() {
  // TODO
  "doc string";
  ;
  int x = 1;
  if (x > 0) { x++; } else { x--; }
  for (int i = 0; i < 2; i++) { svc.run(i); }
  try { svc.go(); } catch (Exception e) { fail(e); }
  return;
} }`);
    expect(t.statementCount).toBe(9);
  });

  it('an empty body or a body of only a comment has zero statements (contextLoads smoke)', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class AppTests {
  @Test void contextLoads() { }
  @Test void withComment() { /* nothing */ }
}`);
    expect(i.tests[0]!.statementCount).toBe(0);
    expect(i.tests[0]!.assertions).toEqual([]);
    expect(i.tests[1]!.statementCount).toBe(0);
  });
});

describe('edge cases', () => {
  it('empty file gives an empty inventory', async () => {
    const i = await inv('');
    expect(i.tests).toEqual([]);
    expect(i.parseErrors).toBe(0);
    expect(i.framework).toBe('junit5');
    expect(i.assertionHelpers.size).toBe(0);
  });

  it('syntax errors are counted and surviving tests are still found', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class FooTest {
  @Test void a() { assertEquals(1, x); }
  @Test void broken() { assertEquals(1, ; }
  int = ;
}`);
    expect(i.parseErrors).toBeGreaterThan(0);
    expect(i.tests.map((t) => t.name)).toContain('a');
  });

  it('a file with only helpers has helpers but no tests', async () => {
    const i = await inv(`${JUNIT5_HEADER}
final class Checks {
  static void assertSorted(List<Integer> xs) { assertEquals(sorted(xs), xs); }
  static void nothing() { }
}`);
    expect(i.tests).toEqual([]);
    expect(i.assertionHelpers).toEqual(new Set(['assertSorted']));
  });

  it('a 300 method class parses under one second', async () => {
    const methods = Array.from({ length: 300 }, (_, k) => `  @Test void test${k}() { Result r = svc.run(${k}); assertEquals(${k}, r.value()); assertThat(r.items()).hasSize(${k % 5}); }`).join('\n');
    const src = `${JUNIT5_HEADER}import static org.assertj.core.api.Assertions.assertThat;\nclass BigTest {\n${methods}\n}`;
    await inv(src);
    const start = performance.now();
    const i = await inv(src);
    const ms = performance.now() - start;
    expect(i.tests).toHaveLength(300);
    expect(i.tests[299]!.qualifiedName).toBe('BigTest#test299');
    expect(i.tests[299]!.assertions).toHaveLength(2);
    expect(ms).toBeLessThan(TIMING_OFF ? Number.POSITIVE_INFINITY : 1000);
  });

  it('duplicate method names in different classes get distinct qualified names', async () => {
    const i = await inv(`${JUNIT5_HEADER}
class ATest { @Test void run() { } }
class BTest { @Test void run() { } }`);
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['ATest#run', 'BTest#run']);
  });
});

describe('name based custom assertions', () => {
  it('counts assert, check, verify, expect, should and validate prefixed calls on any receiver', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    ts.assertValues(1, 2);
    expectAssertionError(() -> svc.run());
    verifyNoDrift();
    TestObserver.assertComplete();
    Checker.checkInvariant(x);
    validateState(x);
    this.shouldBeOk(x);
  }
}`);
    expect(t.assertions.map((a) => [a.callee, a.kind])).toEqual([
      ['assertValues', 'custom'],
      ['expectAssertionError', 'custom'],
      ['verifyNoDrift', 'custom'],
      ['assertComplete', 'custom'],
      ['checkInvariant', 'custom'],
      ['validateState', 'custom'],
      ['shouldBeOk', 'custom'],
    ]);
    expect(t.assertions[0]!.subject).toBe('ts');
    expect(t.assertions[1]!.subject).toBe('() -> svc.run()');
    expect(t.assertions[2]!.subject).toBeUndefined();
  });

  it('finds the terminal of RxJava .test().assertResult(...) chains and Spring .andExpect(...)', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    pp.mergeWith(cs).test().assertResult(1, 1);
    client.get("/x").andExpect(status().isOk());
  }
}`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['assertResult', 'andExpect']);
    expect(t.assertions.every((a) => a.kind === 'custom')).toBe(true);
  });

  it('leaves calls nested in the arguments of another call to the outer call', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.assertj.core.api.Assertions.assertThat;
class FooTest {
  @Test void run() {
    AssertionError e = expectAssertionError(() -> uris.assertHasParameter(info, uri));
    assertThat(e).hasMessage(shouldHaveParameter(uri).create());
  }
}`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['expectAssertionError', 'assertThat.hasMessage']);
  });

  it('does not count checkout, expected or other names where the prefix is not a word', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    cart.checkout();
    cart.expected();
    cart.assertion();
    cart.verifying();
  }
}`);
    expect(t.assertions).toEqual([]);
  });

  it('does not trust a bare call to a local method whose body has no assertion', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() { assertCartReady(cart); }
  private static void assertCartReady(Cart cart) { cart.checkout(); }
}`);
    expect(t.assertions).toEqual([]);
  });

  it('does not reclassify calls already known, such as Mockito verify and JUnit assertEquals', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.mockito.Mockito.verify;
class FooTest {
  @Test void run() {
    assertEquals(1, x);
    verify(mock).go();
  }
}`);
    expect(t.assertions.map((a) => [a.callee, a.kind])).toEqual([
      ['assertEquals', 'value'],
      ['verify', 'interaction'],
    ]);
  });

  it('classifies BDDAssertions.then(actual).hasMessage as an assertj assertion', async () => {
    const t = await one(`${JUNIT5_HEADER}
import static org.assertj.core.api.BDDAssertions.then;
class FooTest {
  @Test void run() { then(error).hasMessage("boom"); }
}`);
    expect(t.assertions.map((a) => [a.callee, a.kind, a.family])).toEqual([['assertThat.hasMessage', 'exception', 'assertj']]);
  });
});

describe('parameterised flag', () => {
  it('sets parameterised on @ParameterizedTest with a dynamic source and no parameterCount', async () => {
    const t = await one(`${JUNIT5_HEADER}
import org.junit.jupiter.params.provider.MethodSource;
class FooTest {
  @ParameterizedTest
  @MethodSource("cases")
  void run(int x) { assertTrue(x > 0); }
}`);
    expect(t.parameterised).toBe(true);
    expect(t.parameterCount).toBeUndefined();
  });

  it('sets parameterised alongside parameterCount for @ValueSource', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @ParameterizedTest
  @ValueSource(ints = {1, 2, 3})
  void run(int x) { assertTrue(x > 0); }
}`);
    expect(t.parameterised).toBe(true);
    expect(t.parameterCount).toBe(3);
  });

  it('sets parameterised for @TestTemplate, @RepeatedTest and TestNG dataProvider', async () => {
    const i = await inv(`${JUNIT5_HEADER}
import org.junit.jupiter.api.TestTemplate;
import org.junit.jupiter.api.RepeatedTest;
class FooTest {
  @TestTemplate void a() { assertTrue(x); }
  @RepeatedTest(3) void b() { assertTrue(x); }
  @Test void c() { assertTrue(x); }
}`);
    expect(i.tests.map((t) => t.parameterised)).toEqual([true, true, undefined]);
    const ng = await one(`${TESTNG_HEADER}
class FooTest {
  @Test(dataProvider = "rows") public void a(int x) { assertTrue(x > 0); }
}`);
    expect(ng.parameterised).toBe(true);
    expect(ng.parameterCount).toBeUndefined();
  });
});

describe('catch alls', () => {
  it('records a swallowing catch of Exception with the try block first statement as snippet', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    try {
      svc.reconcile(   ledger  );
      assertEquals(0, ledger.drift());
    } catch (Exception e) {
      // ignore
    }
  }
}`);
    expect(t.catchAlls).toEqual([{ line: 14, binding: 'Exception', swallows: true, snippet: "svc.reconcile( ledger );" }]);
  });

  it('marks catches that assert, fail, expect or rethrow as not swallowing', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    try { a(); } catch (Throwable e) { assertThat(e).hasMessage("x"); }
    try { b(); } catch (RuntimeException e) { fail("boom"); }
    try { c(); } catch (Error e) { Assert.fail(); }
    try { d(); } catch (Exception e) { throw new IllegalStateException(e); }
    try { f(); } catch (Exception e) { assertEquals(1, e.code()); }
    try { g(); } catch (Exception e) { expectNoFailure(e); }
  }
}`);
    expect(t.catchAlls!.map((c) => [c.binding, c.swallows])).toEqual([
      ['Throwable', false],
      ['RuntimeException', false],
      ['Error', false],
      ['Exception', false],
      ['Exception', false],
      ['Exception', false],
    ]);
  });

  it('handles union types and qualified names, and skips specific exceptions, finally only, lambdas and local classes', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    try { a(); } catch (IOException | RuntimeException e) { }
    try { b(); } catch (java.lang.Exception e) { }
    try { c(); } catch (IOException e) { }
    try { d(); } finally { close(); }
    Runnable r = () -> { try { e(); } catch (Exception x) { } };
    Object o = new Object() { void m() { try { f(); } catch (Exception x) { } } };
  }
}`);
    expect(t.catchAlls!.map((c) => [c.binding, c.swallows, c.snippet])).toEqual([
      ['IOException | RuntimeException', true, 'a();'],
      ['java.lang.Exception', true, 'b();'],
    ]);
  });

  it('does not count capture then assert as swallowing', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test void run() {
    Exception caught = null;
    try { parse(""); } catch (Exception e) { caught = e; }
    assertNotNull(caught);
    Exception lost = null;
    try { parse("x"); } catch (Exception e) { lost = e; }
  }
}`);
    expect(t.catchAlls!.map((c) => c.swallows)).toEqual([false, true]);
  });

  it('leaves catchAlls undefined when the body has no try', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest { @Test void run() { assertTrue(x); } }`);
    expect(t.catchAlls).toBeUndefined();
  });
});

describe('override only', () => {
  it('flags a test whose body only delegates to super', async () => {
    const src = `import org.junit.jupiter.api.*;\nclass CartTest extends BaseCartTest {\n  @Disabled("flaky")\n  @Test\n  @Override\n  void adds() { super.adds(); }\n  @Test\n  void real() { super.adds(); assertEquals(1, 1); }\n}`;
    const inv = await javaFrontEnd.inventory('CartTest.java', src, { frameworks: new Set(), extraAssertions: [] });
    expect(inv.tests.map((t) => [t.name, t.overrideOnly])).toEqual([['adds', true], ['real', undefined]]);
  });
});

describe('inherited test overridden to disable it', () => {
  it('counts an @Override with @Disabled whose body only calls super as a test', async () => {
    const src = `import org.junit.jupiter.api.Disabled;\nclass DockerTest extends BaseDockerTest {\n  @Override\n  @Disabled("flaky after segment drops")\n  public void test_runIndexTask_andKillData() {\n    super.test_runIndexTask_andKillData();\n  }\n  @Override\n  public void helper() { super.helper(); }\n}`;
    const inv = await javaFrontEnd.inventory('DockerTest.java', src, { frameworks: new Set(), extraAssertions: [] });
    expect(inv.tests.map((t) => [t.name, t.overrideOnly, t.markers[0]?.kind])).toEqual([['test_runIndexTask_andKillData', true, 'skip']]);
  });
});

describe('calls (A001 replaced by call)', () => {
  it('lists every method invocation and marks whole expression statements', async () => {
    const t = await one(`${JUNIT5_HEADER}
class FooTest {
  @Test
  void installs() {
    InstallResult result = InstallResult.install("guava");
    result.didCreate(path("lib/guava"));
    System.out.println(result);
    assertEquals(0, result.code());
  }
}
`);
    const calls = (t.calls ?? []).map((c) => `${c.callee}:${c.statement ? 'stmt' : 'nested'}`);
    expect(calls).toEqual(['InstallResult.install:nested', 'result.didCreate:stmt', 'path:nested', 'System.out.println:stmt', 'assertEquals:stmt', 'result.code:nested']);
    expect(t.calls?.find((c) => c.name === 'didCreate')?.line).toBe(t.assertions[0]!.line - 2);
  });
});

describe('CRLF line endings', () => {
  // A Windows repository commits CRLF. The inventory must be the same as for LF: same lines, and no CR left in the
  // text of a multi line assertion, call or snippet, or in a body hash.
  const source = `package com.acme;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CartTest {
  @Test
  void totals() {
    Cart cart = new Cart();
    assertAll(
        () -> assertEquals(200, cart.total()),
        () -> assertTrue(cart.isOpen()));
    try {
      cart.close();
    } catch (Exception e) {
    }
  }
}
`;

  it('gives the same inventory for CRLF as for LF', async () => {
    const lf = await inv(source, 'src/test/java/com/acme/CartTest.java');
    const crlf = await inv(source.replace(/\n/g, '\r\n'), 'src/test/java/com/acme/CartTest.java');
    expect(crlf).toEqual(lf);
    expect(JSON.stringify(crlf.tests)).not.toContain('\\r');
    expect(crlf.tests[0]!.assertions.some((a) => a.text.includes('\n'))).toBe(true);
  });
});
