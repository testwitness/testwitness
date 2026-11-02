import { describe, expect, it } from 'vitest';
import { byName, inv, single, src } from './helpers.test-util.js';

describe('mocha declarations and markers', () => {
  it('detects mocha from chai and reads context, specify, pending and this.skip()', async () => {
    const inventory = await inv(src(`
      import { expect } from 'chai';
      describe('Cart', function () {
        context('when empty', function () {
          specify('has no items', function () {
            expect(cart.items).to.be.empty;
          });
          it('pending test');
          it('skips itself', function () {
            this.skip();
          });
          it('skips on condition', function () {
            if (!process.env.SLOW) this.skip();
            expect(1).to.equal(1);
          });
        });
        it.skip('declared skip', () => {});
        it.only('declared only', () => {});
        xit('x alias', () => {});
        xcontext('x context', () => { it('inside', () => {}); });
      });
    `));
    expect(inventory.framework).toBe('mocha');
    expect(byName(inventory, 'has no items').qualifiedName).toBe('Cart › when empty › has no items');
    const m = (name: string) => byName(inventory, name).markers.map((x) => `${x.marker}:${x.kind}:${x.constant}`);
    expect(m('pending test')).toEqual(['it (pending):todo:true']);
    expect(m('skips itself')).toEqual(['this.skip:skip:true']);
    expect(m('skips on condition')).toEqual(['this.skip:conditional-skip:false']);
    expect(m('declared skip')).toEqual(['it.skip:skip:true']);
    expect(m('declared only')).toEqual(['it.only:focus:true']);
    expect(m('x alias')).toEqual(['xit:skip:true']);
    expect(m('inside')).toEqual(['xcontext:skip:true']);
    expect(byName(inventory, 'pending test').statementCount).toBe(0);
  });

  it('supports the tdd interface with suite and test', async () => {
    const inventory = await inv(src(`
      const assert = require('node:assert/strict');
      suite('Array', function () {
        suite('#indexOf()', function () {
          test('should return -1 when not present', function () {
            assert.equal([1, 2, 3].indexOf(4), -1);
          });
          test.skip('later', function () {});
        });
      });
    `));
    expect(inventory.framework).toBe('mocha');
    expect(inventory.tests.map((t) => t.qualifiedName)).toEqual(['Array › #indexOf() › should return -1 when not present', 'Array › #indexOf() › later']);
    expect(byName(inventory, 'later').markers.map((x) => x.kind)).toEqual(['skip']);
  });

  it('does not count this.timeout and this.retries as markers but counts them as statements', async () => {
    const t = await single(src(`
      const { expect } = require('chai');
      it('slow', function () {
        this.timeout(10000);
        this.retries(3);
        expect(1).to.equal(1);
      });
    `));
    expect(t.markers).toEqual([]);
    expect(t.statementCount).toBe(3);
  });
});

describe('chai expect style', () => {
  it('normalises language chains and classifies terminal matchers', async () => {
    const t = await single(src(`
      import { expect } from 'chai';
      it('chai', async () => {
        expect(a).to.equal(1);
        expect(o).to.deep.equal({ a: 1 });
        expect(o).to.eql({ a: 1 });
        expect(a).to.not.equal(2);
        expect(list).to.include(3);
        expect(list).to.have.lengthOf(3);
        expect(o).to.have.property('a', 1);
        expect(s).to.match(/x/);
        expect(n).to.be.above(1);
        expect(flag).to.be.true;
        expect(x).to.be.null;
        expect(x).to.not.be.undefined;
        expect(x).to.exist;
        expect(x).to.be.ok;
        expect(x).to.be.an('object');
        expect(x).to.be.instanceOf(Foo);
        expect(() => f()).to.throw();
        expect(() => f()).to.throw(TypeError);
        expect(() => f()).to.not.throw();
        await expect(p).to.be.rejectedWith(Error);
        await expect(p).to.eventually.equal(1);
      });
    `));
    expect(t.assertions.map((a) => `${a.callee} ${a.kind} ${a.family} ${a.strength}`)).toEqual([
      'expect.to.equal value value 3',
      'expect.to.deep.equal value value 3',
      'expect.to.eql value value 3',
      'expect.to.not.equal value value 1',
      'expect.to.include value value 2',
      'expect.to.have.lengthOf value value 2',
      'expect.to.have.property value value 2',
      'expect.to.match value value 2',
      'expect.to.be.above value value 2',
      'expect.to.be.true value value 3',
      'expect.to.be.null value value 3',
      'expect.to.not.be.undefined smoke value 1',
      'expect.to.exist smoke value 1',
      'expect.to.be.ok smoke value 1',
      'expect.to.be.an smoke value 1',
      'expect.to.be.instanceOf smoke value 1',
      'expect.to.throw exception exception 1',
      'expect.to.throw exception exception 2',
      'expect.to.not.throw smoke exception 0',
      'expect.to.be.rejectedWith exception exception 2',
      'expect.to.eventually.equal value value 3',
    ]);
    expect(t.assertions[0]!.expected).toBe('1');
    expect(t.assertions[9]!.subject).toBe('flag');
    expect(t.assertions[9]!.text).toBe('expect(flag).to.be.true;');
  });

  it('ignores an unfinished chain that ends on a language word', async () => {
    const t = await single(`it('x', () => { expect(a).to.be; expect(a).to.equal(1); });`);
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.to.equal']);
  });
});

describe('chai should and assert styles', () => {
  it('reads should chains with the subject left of .should', async () => {
    const t = await single(src(`
      import 'chai/register-should';
      it('should style', () => {
        result.should.equal(2);
        result.items.should.have.lengthOf(2);
        (() => f()).should.throw(Error);
        result.should.be.ok;
        user.name.should.not.equal('x');
      });
    `));
    expect(t.assertions.map((a) => [a.callee, a.subject, a.kind, a.strength])).toEqual([
      ['should.equal', 'result', 'value', 3],
      ['should.have.lengthOf', 'result.items', 'value', 2],
      ['should.throw', '() => f()', 'exception', 2],
      ['should.be.ok', 'result', 'smoke', 1],
      ['should.not.equal', 'user.name', 'value', 1],
    ]);
  });

  it('reads chai assert and node assert including throws, rejects, doesNotThrow and fail', async () => {
    const t = await single(src(`
      import assert from 'node:assert';
      it('assert style', async () => {
        assert.strictEqual(actual, expected);
        assert.deepStrictEqual(actual, { a: 1 });
        assert.notStrictEqual(a, b);
        assert.ok(value);
        assert(value);
        assert.match(str, /re/);
        assert.throws(() => f());
        assert.throws(() => f(), RangeError);
        await assert.rejects(p, /nope/);
        assert.doesNotThrow(() => f());
        assert.isNotNull(x);
        assert.instanceOf(x, Foo);
        assert.fail('unreachable');
      });
    `));
    expect(t.assertions.map((a) => `${a.callee} ${a.kind} ${a.family} ${a.strength}`)).toEqual([
      'assert.strictEqual value value 3',
      'assert.deepStrictEqual value value 4',
      'assert.notStrictEqual value value 1',
      'assert.ok smoke value 1',
      'assert smoke value 1',
      'assert.match value value 2',
      'assert.throws exception exception 1',
      'assert.throws exception exception 2',
      'assert.rejects exception exception 2',
      'assert.doesNotThrow smoke exception 0',
      'assert.isNotNull smoke value 1',
      'assert.instanceOf smoke value 1',
      'assert.fail value control 3',
    ]);
    expect(t.assertions[0]!.subject).toBe('actual');
    expect(t.assertions[0]!.expected).toBe('expected');
    expect(t.assertions[1]!.expected).toBe('{ a: 1 }');
  });

  it('reads sinon stubs, spies, mocks and sinon.assert', async () => {
    const t = await single(src(`
      const sinon = require('sinon');
      const { expect } = require('chai');
      describe('svc', () => {
        it('uses sinon', () => {
          const stub = sinon.stub(api, 'fetch').resolves({});
          sinon.spy(logger, 'warn');
          sinon.mock(mailer);
          sinon.replace(clock, 'now', sinon.fake.returns(1));
          const anon = sinon.stub();
          sinon.assert.calledWith(stub, 'x');
          expect(stub).to.have.been.calledOnce;
          expect(stub).to.have.been.calledWith('x');
        });
      });
    `));
    expect(t.mocks).toEqual(['api.fetch', 'logger.warn', 'mailer', 'clock.now']);
    expect(t.assertions.map((a) => [a.callee, a.kind, a.strength])).toEqual([
      ['sinon.assert.calledWith', 'interaction', 3],
      ['expect.to.have.been.calledOnce', 'interaction', 2],
      ['expect.to.have.been.calledWith', 'interaction', 3],
    ]);
  });
});
