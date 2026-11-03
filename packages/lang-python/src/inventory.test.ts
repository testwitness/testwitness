// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { FrameworkProfile, TestCase, TestInventory } from '@testwitness/core';
import { pythonFrontEnd } from './index.js';

const profile: FrameworkProfile = { frameworks: new Set(), extraAssertions: [] };

async function inv(source: string, path = 'tests/test_sample.py', p: FrameworkProfile = profile): Promise<TestInventory> {
  return pythonFrontEnd.inventory(path, source, p);
}

function only(i: TestInventory, name?: string): TestCase {
  const t = name ? i.tests.find((x) => x.qualifiedName === name || x.name === name) : i.tests[0];
  if (!t) throw new Error(`test not found: ${name ?? '(first)'} in ${i.tests.map((x) => x.qualifiedName).join(', ')}`);
  return t;
}

describe('collection: pytest', () => {
  it('collects module level test functions and ignores helpers', async () => {
    const i = await inv(`
def helper():
    return 1

def test_one():
    assert helper() == 1

def not_a_test():
    assert 1 == 1
`);
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['test_one']);
    expect(i.framework).toBe('pytest');
    expect(i.tests[0]!.container).toEqual([]);
    expect(i.tests[0]!.name).toBe('test_one');
  });

  it('collects methods in Test* classes with Class::method names', async () => {
    const i = await inv(`
class TestBilling:
    def test_charge(self):
        assert charge(1) == 1

    def helper(self):
        pass
`);
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['TestBilling::test_charge']);
    expect(i.tests[0]!.container).toEqual(['TestBilling']);
    expect(i.tests[0]!.name).toBe('test_charge');
  });

  it('does not collect Test* classes with __init__', async () => {
    const i = await inv(`
class TestThing:
    def __init__(self):
        self.x = 1
    def test_a(self):
        assert self.x == 1
`);
    expect(i.tests).toEqual([]);
  });

  it('does not collect test_ methods in classes not named Test*', async () => {
    const i = await inv(`
class Helpers:
    def test_a(self):
        assert 1
`);
    expect(i.tests).toEqual([]);
  });

  it('collects nested Test classes with the full container path', async () => {
    const i = await inv(`
class TestOuter:
    class TestInner:
        def test_deep(self):
            assert True
`);
    expect(i.tests[0]!.qualifiedName).toBe('TestOuter::TestInner::test_deep');
    expect(i.tests[0]!.container).toEqual(['TestOuter', 'TestInner']);
  });

  it('collects async tests', async () => {
    const i = await inv(`
import pytest

@pytest.mark.asyncio
async def test_async():
    result = await fetch()
    assert result == 1
`);
    expect(i.tests[0]!.qualifiedName).toBe('test_async');
    expect(i.tests[0]!.assertions).toHaveLength(1);
  });

  it('ignores fixtures even when named test_*', async () => {
    const i = await inv(`
import pytest

@pytest.fixture
def test_data():
    return [1]

def test_uses(test_data):
    assert test_data == [1]
`);
    expect(i.tests.map((t) => t.name)).toEqual(['test_uses']);
  });

  it('ignores functions nested inside other functions', async () => {
    const i = await inv(`
def test_outer():
    def test_inner():
        assert False
    assert True
`);
    expect(i.tests.map((t) => t.name)).toEqual(['test_outer']);
  });
});

describe('collection: unittest', () => {
  it('collects test methods in unittest.TestCase subclasses', async () => {
    const i = await inv(`
import unittest

class BillingTests(unittest.TestCase):
    def test_charge(self):
        self.assertEqual(charge(1), 1)

    def testLegacyName(self):
        self.assertTrue(True)

    def helper(self):
        pass
`);
    expect(i.framework).toBe('unittest');
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['BillingTests::test_charge', 'BillingTests::testLegacyName']);
  });

  it('recognises TestCase imported directly and via alias', async () => {
    const i = await inv(`
from unittest import TestCase as TC
from unittest import IsolatedAsyncioTestCase

class A(TC):
    def test_a(self):
        self.assertEqual(1, 1)

class B(IsolatedAsyncioTestCase):
    async def test_b(self):
        self.assertIsNotNone(await go())
`);
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['A::test_a', 'B::test_b']);
    expect(i.framework).toBe('unittest');
  });

  it('recognises a base class whose name ends in TestCase (best effort)', async () => {
    const i = await inv(`
from django.test import TestCase
from app.testing import BaseAppTestCase

class Views(TestCase):
    def test_index(self):
        self.assertEqual(1, 1)

class More(BaseAppTestCase):
    def test_more(self):
        self.assertTrue(1)
`);
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['Views::test_index', 'More::test_more']);
  });

  it('prefers pytest when both pytest and unittest are imported', async () => {
    const i = await inv(`
import unittest
import pytest

class T(unittest.TestCase):
    def test_a(self):
        with pytest.raises(ValueError):
            int("x")
`);
    expect(i.framework).toBe('pytest');
    expect(i.tests[0]!.framework).toBe('pytest');
  });

  it('falls back to the profile and then to pytest', async () => {
    const src = `
def test_a():
    assert 1
`;
    const a = await inv(src, 'tests/test_a.py', { frameworks: new Set(['unittest']), extraAssertions: [] });
    expect(a.framework).toBe('unittest');
    const b = await inv(src);
    expect(b.framework).toBe('pytest');
  });
});

describe('markers', () => {
  it('reads @pytest.mark.skip with keyword and positional reason', async () => {
    const i = await inv(`
import pytest

@pytest.mark.skip(reason="flaky, see #12")
def test_a():
    assert 1

@pytest.mark.skip("positional")
def test_b():
    assert 1

@pytest.mark.skip
def test_c():
    assert 1
`);
    expect(only(i, 'test_a').markers).toEqual([{ marker: 'pytest.mark.skip', kind: 'skip', constant: true, reason: 'flaky, see #12', line: 4 }]);
    expect(only(i, 'test_b').markers[0]!.reason).toBe('positional');
    expect(only(i, 'test_c').markers[0]).toMatchObject({ marker: 'pytest.mark.skip', kind: 'skip', constant: true });
    expect(only(i, 'test_c').markers[0]!.reason).toBeUndefined();
  });

  it('folds skipif(True) to a constant skip and keeps dynamic conditions as conditional-skip', async () => {
    const i = await inv(`
import pytest
import sys

@pytest.mark.skipif(True, reason="broken")
def test_a():
    assert 1

@pytest.mark.skipif(sys.platform == "win32", reason="windows")
def test_b():
    assert 1

@pytest.mark.skipif(False, reason="never")
def test_c():
    assert 1

@pytest.mark.skipif(not True, reason="folded")
def test_d():
    assert 1
`);
    expect(only(i, 'test_a').markers[0]).toMatchObject({ marker: 'pytest.mark.skipif', kind: 'skip', constant: true, reason: 'broken' });
    expect(only(i, 'test_b').markers[0]).toMatchObject({ marker: 'pytest.mark.skipif', kind: 'conditional-skip', constant: false, reason: 'windows' });
    expect(only(i, 'test_c').markers[0]).toMatchObject({ kind: 'conditional-skip', constant: false });
    expect(only(i, 'test_d').markers[0]).toMatchObject({ kind: 'conditional-skip', constant: false });
  });

  it('reads xfail with strict and reason, conditional and unconditional', async () => {
    const i = await inv(`
import pytest

@pytest.mark.xfail(reason="known bug", strict=True)
def test_a():
    assert 1

@pytest.mark.xfail
def test_b():
    assert 1

@pytest.mark.xfail(sys.version_info < (3, 12), reason="old python")
def test_c():
    assert 1
`);
    expect(only(i, 'test_a').markers[0]).toEqual({ marker: 'pytest.mark.xfail(strict=True)', kind: 'xfail', constant: true, reason: 'known bug', line: 4 });
    expect(only(i, 'test_b').markers[0]).toMatchObject({ marker: 'pytest.mark.xfail', kind: 'xfail', constant: true });
    expect(only(i, 'test_c').markers[0]).toMatchObject({ marker: 'pytest.mark.xfail', kind: 'xfail', constant: false, reason: 'old python' });
  });

  it('treats pytest.skip() as the first statement as a skip, but not later in the body', async () => {
    const i = await inv(`
import pytest

def test_a():
    """Docstring first is fine."""
    pytest.skip("not ready")
    assert 1

def test_b():
    x = 1
    pytest.skip("later")
    assert x
`);
    expect(only(i, 'test_a').markers).toEqual([{ marker: 'pytest.skip', kind: 'skip', constant: true, reason: 'not ready', line: 6 }]);
    expect(only(i, 'test_b').markers).toEqual([]);
  });

  it('reads module level pytestmark as a single mark and as a list', async () => {
    const single = await inv(`
import pytest
pytestmark = pytest.mark.skip(reason="module off")

def test_a():
    assert 1
`);
    expect(single.fileMarkers).toEqual([{ marker: 'pytest.mark.skip', kind: 'skip', constant: true, reason: 'module off', line: 3 }]);
    expect(single.tests[0]!.markers).toEqual(single.fileMarkers);

    const list = await inv(`
import pytest
pytestmark = [pytest.mark.slow, pytest.mark.xfail(strict=True), pytest.mark.skipif(True, reason="x")]

def test_a():
    assert 1
`);
    expect(list.fileMarkers.map((m) => m.marker)).toEqual(['pytest.mark.xfail(strict=True)', 'pytest.mark.skipif']);
    expect(list.tests[0]!.markers).toHaveLength(2);
  });

  it('applies class level marks to every method and stacks them with method marks in any order', async () => {
    const i = await inv(`
import pytest

@pytest.mark.skip(reason="whole class")
class TestX:
    def test_a(self):
        assert 1

    @pytest.mark.parametrize("n", [1, 2])
    @pytest.mark.xfail
    def test_b(self, n):
        assert n

    @pytest.mark.xfail
    @pytest.mark.parametrize("n", [1, 2])
    def test_c(self, n):
        assert n
`);
    expect(only(i, 'TestX::test_a').markers.map((m) => m.kind)).toEqual(['skip']);
    expect(only(i, 'TestX::test_b').markers.map((m) => m.kind)).toEqual(['skip', 'xfail']);
    expect(only(i, 'TestX::test_c').markers.map((m) => m.kind)).toEqual(['skip', 'xfail']);
    expect(only(i, 'TestX::test_b').parameterCount).toBe(2);
    expect(only(i, 'TestX::test_c').parameterCount).toBe(2);
  });

  it('normalises pytest marks when pytest is aliased or mark is imported', async () => {
    const i = await inv(`
import pytest as pt
from pytest import mark

@pt.mark.skip
def test_a():
    assert 1

@mark.skipif(True, reason="r")
def test_b():
    assert 1
`);
    expect(only(i, 'test_a').markers[0]!.marker).toBe('pytest.mark.skip');
    expect(only(i, 'test_b').markers[0]).toMatchObject({ marker: 'pytest.mark.skipif', kind: 'skip', constant: true });
  });

  it('reads unittest skip decorators: skip, skipIf, skipUnless, expectedFailure', async () => {
    const i = await inv(`
import unittest
from unittest import skip, skipIf

class T(unittest.TestCase):
    @unittest.skip("not now")
    def test_a(self):
        self.assertTrue(1)

    @skipIf(True, "always")
    def test_b(self):
        self.assertTrue(1)

    @unittest.skipIf(os.name == "nt", "windows")
    def test_c(self):
        self.assertTrue(1)

    @unittest.skipUnless(False, "never true")
    def test_d(self):
        self.assertTrue(1)

    @unittest.expectedFailure
    def test_e(self):
        self.assertTrue(0)

    @skip
    def test_f(self):
        self.assertTrue(1)
`);
    expect(only(i, 'T::test_a').markers[0]).toEqual({ marker: 'unittest.skip', kind: 'skip', constant: true, reason: 'not now', line: 6 });
    expect(only(i, 'T::test_b').markers[0]).toMatchObject({ marker: 'unittest.skipIf', kind: 'skip', constant: true, reason: 'always' });
    expect(only(i, 'T::test_c').markers[0]).toMatchObject({ marker: 'unittest.skipIf', kind: 'conditional-skip', constant: false, reason: 'windows' });
    expect(only(i, 'T::test_d').markers[0]).toMatchObject({ marker: 'unittest.skipUnless', kind: 'skip', constant: true });
    expect(only(i, 'T::test_e').markers[0]).toMatchObject({ marker: 'unittest.expectedFailure', kind: 'xfail', constant: true });
    expect(only(i, 'T::test_f').markers[0]).toMatchObject({ marker: 'unittest.skip', kind: 'skip', constant: true });
  });

  it('treats self.skipTest() and raise SkipTest as first statement skips', async () => {
    const i = await inv(`
import unittest

class T(unittest.TestCase):
    def test_a(self):
        self.skipTest("no db")
        self.assertTrue(1)

    def test_b(self):
        raise unittest.SkipTest("no network")

    def test_c(self):
        x = 1
        self.skipTest("late")
`);
    expect(only(i, 'T::test_a').markers).toEqual([{ marker: 'self.skipTest', kind: 'skip', constant: true, reason: 'no db', line: 6 }]);
    expect(only(i, 'T::test_b').markers[0]).toMatchObject({ marker: 'unittest.SkipTest', kind: 'skip', constant: true, reason: 'no network' });
    expect(only(i, 'T::test_c').markers).toEqual([]);
  });

  it('skip decorated class applies to unittest methods too', async () => {
    const i = await inv(`
import unittest

@unittest.skip("all off")
class T(unittest.TestCase):
    def test_a(self):
        self.assertTrue(1)
`);
    expect(only(i).markers).toEqual([{ marker: 'unittest.skip', kind: 'skip', constant: true, reason: 'all off', line: 4 }]);
  });
});

describe('assertions: pytest bare assert', () => {
  it('classifies == with a literal as the strongest value assertion with the left operand as subject', async () => {
    const i = await inv(`
def test_a():
    result = compute()
    assert result == 42
`);
    const a = only(i).assertions[0]!;
    expect(a).toMatchObject({ callee: 'assert', subject: 'result', kind: 'value', family: 'pytest.assert', text: 'assert result == 42', line: 4 });
    expect(a.strength).toBeGreaterThan(0);
  });

  it('orders the lattice: == literal > == expression > is not None > bare truthiness', async () => {
    const i = await inv(`
def test_a():
    assert x == 1
    assert x == y
    assert x is not None
    assert x
    assert not x
`);
    const [lit, eq, notNone, truthy, falsy] = only(i).assertions.map((a) => a.strength!);
    expect(lit!).toBeGreaterThan(eq!);
    expect(eq!).toBeGreaterThan(notNone!);
    expect(notNone!).toBeGreaterThan(truthy!);
    expect(falsy).toBe(truthy);
    const kinds = only(i).assertions.map((a) => a.kind);
    expect(kinds).toEqual(['value', 'value', 'smoke', 'smoke', 'smoke']);
    expect(only(i).assertions.every((a) => a.family === 'pytest.assert')).toBe(true);
  });

  it('handles comparison, membership, identity, isinstance and approx shapes', async () => {
    const i = await inv(`
import pytest

def test_a():
    assert len(items) > 2
    assert "err" in str(exc)
    assert a is b
    assert isinstance(obj, Thing)
    assert value == pytest.approx(0.3)
    assert 1 < x < 10
    assert x != 3
`);
    const as = only(i).assertions;
    expect(as.map((a) => a.kind)).toEqual(['value', 'value', 'value', 'smoke', 'value', 'value', 'value']);
    expect(as[0]!.subject).toBe('len(items)');
    expect(as[1]!.subject).toBe('str(exc)');
    expect(as[3]!.subject).toBe('obj');
    expect(as[4]!.subject).toBe('value');
    expect(as[4]!.strength).toBeGreaterThan(as[0]!.strength!);
    expect(as.every((a) => a.callee === 'assert')).toBe(true);
  });

  it('treats assert on mock state as an interaction assertion', async () => {
    const i = await inv(`
def test_a():
    assert m.called
    assert m.call_count == 2
`);
    const as = only(i).assertions;
    expect(as.map((a) => a.kind)).toEqual(['interaction', 'interaction']);
    expect(as[0]!.subject).toBe('m.called');
    expect(as[1]!.subject).toBe('m.call_count');
  });

  it('keeps the assertion message out of the subject and uses the first operand of and/or', async () => {
    const i = await inv(`
def test_a():
    assert a == 1, "a should be one"
    assert b == 2 and c == 3
`);
    const as = only(i).assertions;
    expect(as[0]!.subject).toBe('a');
    expect(as[1]!.subject).toBe('b');
    expect(as[1]!.kind).toBe('value');
  });

  it('finds assertions nested in if, for, try and with blocks but not in nested defs', async () => {
    const i = await inv(`
def test_a():
    for item in items:
        if item:
            assert item > 0
    try:
        go()
    except ValueError:
        assert False
    with open("f") as f:
        assert f.read() == "x"
    def inner():
        assert "ignored"
`);
    expect(only(i).assertions).toHaveLength(3);
    expect(only(i).assertions.map((a) => a.line)).toEqual([5, 9, 11]);
  });
});

describe('assertions: pytest.raises and warns', () => {
  it('records with pytest.raises as an exception assertion with the called expression as subject', async () => {
    const i = await inv(`
import pytest

def test_a():
    with pytest.raises(ValueError):
        parse("bad")

def test_b():
    with pytest.raises(ValueError) as exc:
        result = parse("bad")
        other()
    assert "bad" in str(exc.value)

def test_c():
    with pytest.raises(KeyError), other_cm():
        lookup = table["x"]
`);
    expect(only(i, 'test_a').assertions).toEqual([
      { callee: 'pytest.raises', subject: 'parse("bad")', text: 'with pytest.raises(ValueError):', line: 5, kind: 'exception' },
    ]);
    const b = only(i, 'test_b').assertions;
    expect(b[0]).toMatchObject({ callee: 'pytest.raises', kind: 'exception' });
    expect(b[0]!.subject).toBeUndefined();
    expect(b[1]!.kind).toBe('value');
    expect(only(i, 'test_c').assertions[0]!.subject).toBe('table["x"]');
  });

  it('records pytest.warns, deprecated_call and the call form of raises', async () => {
    const i = await inv(`
import pytest
from pytest import raises

def test_a():
    with pytest.warns(DeprecationWarning):
        old()
    with pytest.deprecated_call():
        older()
    pytest.raises(ValueError, parse, "bad")
    raises(TypeError, parse, 1)
`);
    const as = only(i).assertions;
    expect(as.map((a) => a.callee)).toEqual(['pytest.warns', 'pytest.deprecated_call', 'pytest.raises', 'pytest.raises']);
    expect(as.every((a) => a.kind === 'exception')).toBe(true);
    expect(as[2]!.subject).toBe('parse');
  });
});

describe('assertions: unittest', () => {
  it('classifies self.assert* methods with subject, callee and lattice', async () => {
    const i = await inv(`
import unittest

class T(unittest.TestCase):
    def test_a(self):
        self.assertEqual(charge(1), 100)
        self.assertIsNotNone(charge(1))
        self.assertTrue(charge(1))
        self.assertIn("a", items)
        self.fail("boom")
`);
    const as = only(i).assertions;
    expect(as.map((a) => a.callee)).toEqual(['self.assertEqual', 'self.assertIsNotNone', 'self.assertTrue', 'self.assertIn', 'self.fail']);
    expect(as.map((a) => a.kind)).toEqual(['value', 'smoke', 'smoke', 'value', 'value']);
    expect(as[0]!.subject).toBe('charge(1)');
    expect(as[0]!.strength!).toBeGreaterThan(as[1]!.strength!);
    expect(as[1]!.strength!).toBeGreaterThan(as[2]!.strength!);
    expect(as.slice(0, 4).every((a) => a.family === 'unittest.assert')).toBe(true);
    expect(as[4]!.family).toBeUndefined();
  });

  it('classifies assertRaises in with and call form as exception assertions', async () => {
    const i = await inv(`
import unittest

class T(unittest.TestCase):
    def test_a(self):
        with self.assertRaises(ValueError):
            parse("bad")
        self.assertRaises(ValueError, parse, "bad")
        with self.assertRaisesRegex(ValueError, "bad"):
            parse("bad")
        with self.assertWarns(DeprecationWarning):
            old()
`);
    const as = only(i).assertions;
    expect(as.map((a) => a.kind)).toEqual(['exception', 'exception', 'exception', 'exception']);
    expect(as[0]!.callee).toBe('self.assertRaises');
    expect(as[0]!.subject).toBe('parse("bad")');
    expect(as[1]!.subject).toBe('parse');
  });

  it('recognises assert methods on receivers other than self', async () => {
    const i = await inv(`
import unittest
import numpy as np

class T(unittest.TestCase):
    def test_a(self):
        tc = self
        tc.assertEqual(1, 1)
        np.testing.assert_array_equal(a, b)
        assert_frame_equal(df1, df2)
`);
    const as = only(i).assertions;
    expect(as.map((a) => a.callee)).toEqual(['tc.assertEqual', 'numpy.testing.assert_array_equal', 'assert_frame_equal']);
    expect(as.map((a) => a.kind)).toEqual(['value', 'value', 'value']);
    expect(as[2]!.subject).toBe('df1');
  });
});

describe('assertions: mocks', () => {
  it('records mock.assert_called* on any receiver as interaction assertions in lattice order', async () => {
    const i = await inv(`
def test_a():
    svc.charge.assert_called_once_with(1)
    svc.charge.assert_called_once()
    svc.charge.assert_called()
    svc.charge.assert_not_called()
    svc.charge.assert_called_with(1)
    svc.charge.assert_any_call(1)
    svc.charge.assert_has_calls([])

async def test_b():
    await svc.fetch.assert_awaited_once()
    svc.fetch.assert_awaited()
`);
    const as = only(i, 'test_a').assertions;
    expect(as.every((a) => a.kind === 'interaction' && a.family === 'mock.calls' && a.subject === 'svc.charge')).toBe(true);
    expect(as.map((a) => a.callee)).toEqual([
      'assert_called_once_with',
      'assert_called_once',
      'assert_called',
      'assert_not_called',
      'assert_called_with',
      'assert_any_call',
      'assert_has_calls',
    ]);
    const [onceWith, once, called] = as.map((a) => a.strength!);
    expect(onceWith!).toBeGreaterThan(once!);
    expect(once!).toBeGreaterThan(called!);
    const b = only(i, 'test_b').assertions;
    expect(b.map((a) => a.callee)).toEqual(['assert_awaited_once', 'assert_awaited']);
    expect(b[0]!.kind).toBe('interaction');
  });
});

describe('assertions: custom helpers', () => {
  it('detects helpers in the same file and classifies calls to them as custom', async () => {
    const i = await inv(`
def check_invoice(inv):
    assert inv.total > 0
    assert inv.paid

def no_assert_here(x):
    return x

def test_a():
    check_invoice(make())
    no_assert_here(1)
`);
    expect([...i.assertionHelpers]).toEqual(['check_invoice']);
    expect(only(i).assertions).toEqual([
      { callee: 'check_invoice', subject: 'make()', text: 'check_invoice(make())', line: 10, kind: 'custom' },
    ]);
  });

  it('detects method helpers called through self and helpers named in the profile', async () => {
    const i = await inv(
      `
import unittest

class T(unittest.TestCase):
    def assert_ok(self, resp):
        self.assertEqual(resp.status, 200)

    def test_a(self):
        self.assert_ok(get())
        verify_shape(x)
`,
      'tests/test_x.py',
      { frameworks: new Set(), extraAssertions: ['verify_shape'] },
    );
    const as = only(i).assertions;
    expect(as.map((a) => [a.callee, a.kind])).toEqual([
      ['self.assert_ok', 'custom'],
      ['verify_shape', 'custom'],
    ]);
    expect([...i.assertionHelpers]).toEqual(['assert_ok']);
  });

  it('does not chain helpers more than one level deep', async () => {
    const i = await inv(`
def leaf(x):
    assert x

def middle(x):
    leaf(x)

def test_a():
    middle(1)
`);
    expect([...i.assertionHelpers]).toEqual(['leaf']);
    expect(only(i).assertions).toEqual([]);
  });
});

describe('parameterCount', () => {
  it('counts literal parametrize cases and multiplies stacked decorators', async () => {
    const i = await inv(`
import pytest

@pytest.mark.parametrize("a", [1, 2, 3])
def test_a(a):
    assert a

@pytest.mark.parametrize("a", [1, 2])
@pytest.mark.parametrize("b", (3, 4, 5))
def test_b(a, b):
    assert a and b

@pytest.mark.parametrize("a,b", [(1, 2), (3, 4)], ids=["x", "y"])
def test_c(a, b):
    assert a < b
`);
    expect(only(i, 'test_a').parameterCount).toBe(3);
    expect(only(i, 'test_b').parameterCount).toBe(6);
    expect(only(i, 'test_c').parameterCount).toBe(2);
  });

  it('is undefined when the cases are a name or a call, or when absent', async () => {
    const i = await inv(`
import pytest

CASES = [1, 2]

@pytest.mark.parametrize("a", CASES)
def test_a(a):
    assert a

@pytest.mark.parametrize("a", load_cases())
def test_b(a):
    assert a

@pytest.mark.parametrize("a", [1, 2])
@pytest.mark.parametrize("b", CASES)
def test_c(a, b):
    assert a

def test_d():
    assert 1
`);
    expect(only(i, 'test_a').parameterCount).toBeUndefined();
    expect(only(i, 'test_b').parameterCount).toBeUndefined();
    expect(only(i, 'test_c').parameterCount).toBeUndefined();
    expect(only(i, 'test_d').parameterCount).toBeUndefined();
  });

  it('multiplies class level parametrize into every method', async () => {
    const i = await inv(`
import pytest

@pytest.mark.parametrize("n", [1, 2])
class TestX:
    @pytest.mark.parametrize("m", [1, 2, 3])
    def test_a(self, n, m):
        assert n

    def test_b(self, n):
        assert n
`);
    expect(only(i, 'TestX::test_a').parameterCount).toBe(6);
    expect(only(i, 'TestX::test_b').parameterCount).toBe(2);
  });
});

describe('mocks', () => {
  it('normalises mock.patch, patch, patch.object, patch.dict and mocker.patch targets', async () => {
    const i = await inv(`
from unittest import mock
from unittest.mock import patch

def test_a(mocker):
    with mock.patch("app.billing.charge") as m:
        pass
    with patch("app.billing.refund"):
        pass
    patch.object(Billing, "charge").start()
    mock.patch.object(Billing, "refund", autospec=True)
    patch.dict("os.environ", {"A": "1"})
    mocker.patch("app.billing.notify")
    mocker.patch.object(Billing, "audit")
    mock.patch("app.billing.charge")
`);
    expect(only(i).mocks).toEqual([
      'app.billing.charge',
      'app.billing.refund',
      'Billing.charge',
      'Billing.refund',
      'os.environ',
      'app.billing.notify',
      'Billing.audit',
    ]);
  });

  it('records @patch decorators on the test and on the class', async () => {
    const i = await inv(`
from unittest.mock import patch

@patch("app.clock.now")
class TestX:
    @patch("app.billing.charge")
    @patch.object(Billing, "refund")
    def test_a(self, refund, charge, now):
        assert charge
`);
    expect(only(i).mocks).toEqual(['app.clock.now', 'app.billing.charge', 'Billing.refund']);
  });

  it('records monkeypatch.setattr in both forms and ignores unrelated setattr calls', async () => {
    const i = await inv(`
def test_a(monkeypatch):
    monkeypatch.setattr(app.billing, "charge", fake)
    monkeypatch.setattr("app.billing.refund", fake)
    monkeypatch.setitem(config, "debug", True)
    monkeypatch.setenv("API_KEY", "x")
    setattr(obj, "name", 1)
    thing.patch()
`);
    expect(only(i).mocks).toEqual(['app.billing.charge', 'app.billing.refund', 'config.debug', 'os.environ.API_KEY']);
  });
});

describe('body hash and statement count', () => {
  it('hashes the body only so a renamed test keeps its hash', async () => {
    const a = await inv(`
def test_one():
    x = 1
    assert x == 1
`);
    const b = await inv(`
def test_two():
    x = 1   # a comment
    assert x == 1
`);
    expect(a.tests[0]!.bodyHash).toBe(b.tests[0]!.bodyHash);
    expect(a.tests[0]!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes the hash when the body changes', async () => {
    const a = await inv(`
def test_one():
    assert x == 1
`);
    const b = await inv(`
def test_one():
    assert x == 2
`);
    expect(a.tests[0]!.bodyHash).not.toBe(b.tests[0]!.bodyHash);
  });

  it('excludes pass, docstrings, bare return and comments from the statement count', async () => {
    const i = await inv(`
def test_a():
    """Docstring."""
    # a comment
    pass
    return

def test_b():
    x = 1
    if x:
        y = 2
    with ctx():
        go()
    return x

def test_c():
    pass
`);
    expect(only(i, 'test_a').statementCount).toBe(0);
    expect(only(i, 'test_b').statementCount).toBe(6);
    expect(only(i, 'test_c').statementCount).toBe(0);
  });

  it('reports start and end lines including decorators', async () => {
    const i = await inv(`import pytest

@pytest.mark.slow
def test_a():
    assert 1
    assert 2
`);
    expect(only(i).startLine).toBe(3);
    expect(only(i).endLine).toBe(6);
  });
});

describe('imports and file level data', () => {
  it('lists imports in dotted form', async () => {
    const i = await inv(`
import pytest
import os.path
from unittest import mock
from unittest.mock import patch, MagicMock as MM
from . import helpers

def test_a():
    assert 1
`);
    expect(i.imports).toEqual(['pytest', 'os.path', 'unittest.mock', 'unittest.mock.patch', 'unittest.mock.MagicMock', '.helpers']);
    expect(i.path).toBe('tests/test_sample.py');
    expect(i.language).toBe('python');
  });
});

describe('edge cases', () => {
  it('handles an empty file', async () => {
    const i = await inv('');
    expect(i.tests).toEqual([]);
    expect(i.parseErrors).toBe(0);
    expect(i.framework).toBe('pytest');
    expect(i.fileMarkers).toEqual([]);
    expect([...i.assertionHelpers]).toEqual([]);
  });

  it('counts parse errors and still collects what it can', async () => {
    const i = await inv(`
def test_ok():
    assert 1 == 1

def test_broken(:
    assert (1 ==
`);
    expect(i.parseErrors).toBeGreaterThan(0);
    expect(i.tests.some((t) => t.name === 'test_ok')).toBe(true);
    expect(i.tests.find((t) => t.name === 'test_ok')!.assertions).toHaveLength(1);
  });

  it('handles a file with only helpers', async () => {
    const i = await inv(`
def check(x):
    assert x

def other():
    return 1
`);
    expect(i.tests).toEqual([]);
    expect([...i.assertionHelpers]).toEqual(['check']);
  });

  it('handles tests with no assertions', async () => {
    const i = await inv(`
def test_smoke():
    run()
`);
    expect(only(i).assertions).toEqual([]);
    expect(only(i).statementCount).toBe(1);
  });

  it('parses a 300 test module in under a second', async () => {
    const parts: string[] = ['import pytest', ''];
    for (let n = 0; n < 300; n++) {
      parts.push(`@pytest.mark.parametrize("v", [1, 2, 3])`);
      parts.push(`def test_case_${n}(v):`);
      parts.push(`    result = compute(${n}, v)`);
      parts.push(`    assert result == ${n}`);
      parts.push(`    assert result is not None`);
      parts.push(`    with pytest.raises(ValueError):`);
      parts.push(`        compute(-1, v)`);
      parts.push('');
    }
    const source = parts.join('\n');
    await inv('def test_warm():\n    assert 1\n');
    const start = performance.now();
    const i = await inv(source);
    const elapsed = performance.now() - start;
    expect(i.tests).toHaveLength(300);
    expect(i.tests.every((t) => t.assertions.length === 3 && t.parameterCount === 3)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('expected operand and imperative xfail', () => {
  it('records the expected operand of == and of two argument unittest assertions', async () => {
    const i = await inv(`
import unittest

def test_a():
    assert cart.total() == 9
    assert 9 == cart.total()
    assert cart.total() == cart.total()
    assert cart.total()
    assert 1 < cart.total() < 3

class CartTest(unittest.TestCase):
    def test_b(self):
        self.assertEqual(cart.total(), 9)
        self.assertEqual(cart.total(), cart.total())
        self.assertTrue(cart.total())
`);
    const a = only(i, 'test_a').assertions;
    expect(a[0]).toMatchObject({ subject: 'cart.total()', expected: '9' });
    expect(a[1]).toMatchObject({ subject: 'cart.total()', expected: '9' });
    expect(a[2]).toMatchObject({ subject: 'cart.total()', expected: 'cart.total()' });
    expect(a[3]!.expected).toBeUndefined();
    expect(a[4]!.expected).toBeUndefined();
    const b = only(i, 'CartTest::test_b').assertions;
    expect(b[0]).toMatchObject({ subject: 'cart.total()', expected: '9' });
    expect(b[1]).toMatchObject({ subject: 'cart.total()', expected: 'cart.total()' });
    expect(b[2]!.expected).toBeUndefined();
  });

  it('treats pytest.xfail() as the first statement as an xfail marker', async () => {
    const i = await inv(`
import pytest

def test_a():
    pytest.xfail("PAY-412 rounding drift")
    assert 1

def test_b():
    x = 1
    pytest.xfail("later")
    assert x
`);
    expect(only(i, 'test_a').markers).toEqual([{ marker: 'pytest.xfail', kind: 'xfail', constant: true, reason: 'PAY-412 rounding drift', line: 5 }]);
    expect(only(i, 'test_b').markers).toEqual([]);
  });
});

describe('parametrize arguments bound to literal values', () => {
  it('treats == against a literal parametrize argument as a literal equality', async () => {
    const i = await inv(`
import pytest

@pytest.mark.parametrize("lines, expected", [(1, 2), (3, 4)])
def test_a(lines, expected):
    assert total(lines) == expected
    assert total(lines) == lines * 2

@pytest.mark.parametrize(["n", "want"], [(1, 2)])
def test_b(n, want):
    assert total(n) == want

@pytest.mark.parametrize("n, want", CASES)
def test_c(n, want):
    assert total(n) == want

def test_d():
    expected = 2
    assert total(1) == expected
`);
    const a = only(i, 'test_a').assertions;
    expect(a[0]!.strength).toBe(5);
    expect(a[1]!.strength).toBe(4);
    expect(only(i, 'test_b').assertions[0]!.strength).toBe(5);
    expect(only(i, 'test_c').assertions[0]!.strength).toBe(4);
    expect(only(i, 'test_d').assertions[0]!.strength).toBe(4);
  });
});

describe('parameterised flag and catch alls', () => {
  it('marks dynamic parametrize as parameterised with no count', async () => {
    const inv = await pythonFrontEnd.inventory('tests/test_x.py', `import pytest\nCASES = [1, 2]\n@pytest.mark.parametrize("n", CASES)\ndef test_a(n):\n    assert n\n\ndef test_b():\n    assert 1\n`, { frameworks: new Set(), extraAssertions: [] });
    const a = inv.tests.find((t) => t.name === 'test_a')!;
    expect(a.parameterised).toBe(true);
    expect(a.parameterCount).toBeUndefined();
    expect(inv.tests.find((t) => t.name === 'test_b')!.parameterised).toBeUndefined();
  });
  it('collects swallowing catch alls and ignores narrow or asserting ones', async () => {
    const src = `def test_a():\n    try:\n        svc.reconcile(ledger)\n        assert ledger.drift() == 0\n    except Exception:\n        pass\n\ndef test_b():\n    try:\n        svc.run()\n    except ValueError:\n        pass\n\ndef test_c():\n    try:\n        svc.run()\n    except Exception as e:\n        assert "boom" in str(e)\n\ndef test_d():\n    try:\n        svc.run()\n    except:\n        raise\n`;
    const inv = await pythonFrontEnd.inventory('tests/test_x.py', src, { frameworks: new Set(), extraAssertions: [] });
    const by = (n: string) => inv.tests.find((t) => t.name === n)!;
    expect(by('test_a').catchAlls).toEqual([{ line: 5, binding: 'Exception', swallows: true, snippet: 'svc.reconcile(ledger)' }]);
    expect(by('test_b').catchAlls).toBeUndefined();
    expect(by('test_c').catchAlls![0]!.swallows).toBe(false);
    expect(by('test_d').catchAlls![0]!).toMatchObject({ binding: 'bare except', swallows: false });
  });
});

describe('assertion helper used as an assignment value', () => {
  it('counts the helper call on the right side of an assignment', async () => {
    const src = `class T(unittest.TestCase):\n    def assertSent(self):\n        self.assertEqual(len(outbox), 1)\n        return outbox[0]\n\n    def test_a(self):\n        msg = self.assertSent()\n        self.assertEqual(msg.to, ["x"])\n`;
    const inv = await pythonFrontEnd.inventory('tests/test_x.py', src, { frameworks: new Set(), extraAssertions: [] });
    expect(inv.tests[0]!.assertions.map((a) => a.callee)).toEqual(['self.assertSent', 'self.assertEqual']);
  });
});
