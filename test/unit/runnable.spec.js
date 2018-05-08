'use strict';

var mocha = require('../../lib/mocha');
var utils = mocha.utils;
var Runnable = mocha.Runnable;
var Suite = mocha.Suite;

/**
 * Custom assert function.
 * Because of the below "poison pill", we cannot trust third-party code
 * including assertion libraries, not to call the global functions we're
 * poisoning--so we must make our own assertions.
 * @param {*} expr - Throws if false
 */
function assert(expr) {
  if (!expr) {
    throw new Error('assertion failure');
  }
}

describe('Runnable(title, fn)', function() {
  describe('#timeout(ms)', function() {
    it('should set the timeout', function() {
      var run = new Runnable();
      run.timeout(1000);
      assert(run.timeout() === 1000);
    });

    describe('when ms>2^31', function() {
      it('should set disabled', function() {
        var run = new Runnable();
        run.timeout(1e10);
        assert(run.enableTimeouts() === false);
      });
    });
  });

  describe('when passed a time-formatted string', function() {
    it('should convert to ms', function() {
      var run = new Runnable();
      run.timeout('1s');
      assert(run.timeout() === 1000);
    });
  });

  describe('#enableTimeouts(enabled)', function() {
    it('should set enabled', function() {
      var run = new Runnable();
      run.enableTimeouts(false);
      assert(run.enableTimeouts() === false);
    });
  });

  describe('#slow(ms)', function() {
    var run;

    beforeEach(function() {
      run = new Runnable();
    });

    it('should set the slow threshold', function() {
      run.slow(100);
      assert(run.slow() === 100);
    });

    it('should not set the slow threshold if the parameter is not passed', function() {
      run.slow();
      assert(run.slow() === 75);
    });

    it('should not set the slow threshold if the parameter is undefined', function() {
      run.slow(undefined);
      assert(run.slow() === 75);
    });

    describe('when passed a time-formatted string', function() {
      it('should convert to ms', function() {
        run.slow('1s');
        assert(run.slow() === 1000);
      });
    });
  });

  describe('.title', function() {
    it('should be present', function() {
      assert(new Runnable('foo').title === 'foo');
    });
  });

  describe('.titlePath()', function() {
    it("returns the concatenation of the parent's title path and runnable's title", function() {
      var runnable = new Runnable('bar');
      runnable.parent = new Suite('foo');
      assert(
        JSON.stringify(runnable.titlePath()) === JSON.stringify(['foo', 'bar'])
      );
    });
  });

  describe('when arity >= 1', function() {
    it('should be .async', function() {
      var run = new Runnable('foo', function(done) {});
      assert(run.async === 1);
      assert(run.sync === false);
    });
  });

  describe('when arity == 0', function() {
    it('should be .sync', function() {
      var run = new Runnable('foo', function() {});
      assert(run.async === 0);
      assert(run.sync === true);
    });
  });

  describe('#globals', function() {
    it('should allow for whitelisting globals', function(done) {
      var runnable = new Runnable('foo', function() {});
      assert(runnable.async === 0);
      assert(runnable.sync === true);
      runnable.globals(['foobar']);
      runnable.run(done);
    });
  });

  describe('#retries(n)', function() {
    it('should set the number of retries', function() {
      var run = new Runnable();
      run.retries(1);
      assert(run.retries() === 1);
    });
  });

  describe('.run(fn)', function() {
    describe('when .pending', function() {
      it('should not invoke the callback', function(done) {
        var runnable = new Runnable('foo', function() {
          throw new Error('should not be called');
        });

        runnable.pending = true;
        runnable.run(done);
      });
    });

    describe('when sync', function() {
      describe('without error', function() {
        it('should invoke the callback', function(done) {
          var calls = 0;
          var runnable = new Runnable('foo', function() {
            ++calls;
          });

          runnable.run(function(err) {
            if (err) {
              done(err);
              return;
            }

            try {
              assert(calls === 1);
              assert(typeof runnable.duration === 'number');
            } catch (err) {
              done(err);
              return;
            }
            done();
          });
        });
      });

      describe('when an exception is thrown', function() {
        it('should invoke the callback', function(done) {
          var calls = 0;
          var runnable = new Runnable('foo', function() {
            ++calls;
            throw new Error('fail');
          });

          runnable.run(function(err) {
            assert(calls === 1);
            assert(err.message === 'fail');
            done();
          });
        });
      });

      describe('when an exception is thrown and is allowed to remain uncaught', function() {
        it('throws an error when it is allowed', function(done) {
          var runnable = new Runnable('foo', function() {
            throw new Error('fail');
          });
          runnable.allowUncaught = true;

          function fail() {
            runnable.run(function() {});
          }
          try {
            fail();
            done(new Error('failed to throw'));
          } catch (e) {
            assert(e.message === 'fail');
            done();
          }
        });
      });
    });

    describe('when timeouts are disabled', function() {
      it('should not error with timeout', function(done) {
        var runnable = new Runnable('foo', function(done) {
          setTimeout(function() {
            setTimeout(done);
          }, 2);
        });
        runnable.timeout(1);
        runnable.enableTimeouts(false);
        runnable.run(done);
      });
    });

    describe('when async', function() {
      describe('without error', function() {
        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function(done) {
            setTimeout(done);
          });

          runnable.run(done);
        });
      });

      describe('when the callback is invoked several times', function() {
        describe('without an error', function() {
          it('should emit a single "error" event', function(done) {
            var calls = 0;
            var errCalls = 0;

            var runnable = new Runnable('foo', function(done) {
              process.nextTick(done);
              setTimeout(done);
              setTimeout(done);
              setTimeout(done);
            });

            runnable.on('error', function(err) {
              ++errCalls;
              assert(err.message === 'done() called multiple times');
              assert(calls === 1);
              assert(errCalls === 1);
              done();
            });

            runnable.run(function() {
              ++calls;
            });
          });
        });

        describe('with an error', function() {
          it('should emit a single "error" event', function(done) {
            var calls = 0;
            var errCalls = 0;

            var runnable = new Runnable('foo', function(done) {
              done(new Error('fail'));
              setTimeout(done);
              done(new Error('fail'));
              setTimeout(done);
              setTimeout(done);
            });

            runnable.on('error', function(err) {
              ++errCalls;
              assert(
                err.message ===
                  "fail (and Mocha's done() called multiple times)"
              );
              assert(calls === 1);
              assert(errCalls === 1);
              done();
            });

            runnable.run(function() {
              ++calls;
            });
          });
        });
      });

      describe('when an exception is thrown', function() {
        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function(done) {
            throw new Error('fail');
          });

          runnable.run(function(err) {
            assert(err.message === 'fail');
            done();
          });
        });

        it('should not throw its own exception if passed a non-object', function(done) {
          var runnable = new Runnable('foo', function(done) {
            /* eslint no-throw-literal: off */
            throw null;
          });

          runnable.run(function(err) {
            assert(err.message === utils.undefinedError().message);
            done();
          });
        });
      });

      describe('when an exception is thrown and is allowed to remain uncaught', function() {
        it('throws an error when it is allowed', function(done) {
          var runnable = new Runnable('foo', function(done) {
            throw new Error('fail');
          });
          runnable.allowUncaught = true;

          function fail() {
            runnable.run(function() {});
          }
          try {
            fail();
            done(new Error('failed to throw'));
          } catch (e) {
            assert(e.message === 'fail');
          }
          done();
        });
      });

      describe('when an error is passed', function() {
        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function(done) {
            done(new Error('fail'));
          });

          runnable.run(function(err) {
            assert(err.message === 'fail');
            done();
          });
        });
      });

      describe('when done() is invoked with a non-Error object', function() {
        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function(done) {
            done({
              error: 'Test error'
            });
          });

          runnable.run(function(err) {
            assert(
              err.message ===
                'done() invoked with non-Error: {"error":"Test error"}'
            );
            done();
          });
        });
      });

      describe('when done() is invoked with a string', function() {
        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function(done) {
            done('Test error');
          });

          runnable.run(function(err) {
            assert(err.message === 'done() invoked with non-Error: Test error');
            done();
          });
        });
      });

      it('should allow updating the timeout', function(done) {
        var callCount = 0;
        var increment = function() {
          callCount++;
        };
        var runnable = new Runnable('foo', function(done) {
          setTimeout(increment, 1);
          setTimeout(increment, 100);
        });
        runnable.timeout(50);
        runnable.run(function(err) {
          assert(err);
          assert(callCount === 1);
          done();
        });
      });

      it('should allow a timeout of 0');
    });

    describe('when fn returns a promise', function() {
      describe('when the promise is fulfilled with no value', function() {
        var fulfilledPromise = {
          then: function(fulfilled, rejected) {
            setTimeout(fulfilled);
          }
        };

        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function() {
            return fulfilledPromise;
          });

          runnable.run(done);
        });
      });

      describe('when the promise is fulfilled with a value', function() {
        var fulfilledPromise = {
          then: function(fulfilled, rejected) {
            setTimeout(function() {
              fulfilled({});
            });
          }
        };

        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function() {
            return fulfilledPromise;
          });

          runnable.run(done);
        });
      });

      describe('when the promise is rejected', function() {
        var expectedErr = new Error('fail');
        var rejectedPromise = {
          then: function(fulfilled, rejected) {
            setTimeout(function() {
              rejected(expectedErr);
            });
          }
        };

        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function() {
            return rejectedPromise;
          });

          runnable.run(function(err) {
            assert(err === expectedErr);
            done();
          });
        });
      });

      describe('when the promise is rejected without a reason', function() {
        var expectedErr = new Error('Promise rejected with no or falsy reason');
        var rejectedPromise = {
          then: function(fulfilled, rejected) {
            setTimeout(function() {
              rejected();
            });
          }
        };

        it('should invoke the callback', function(done) {
          var runnable = new Runnable('foo', function() {
            return rejectedPromise;
          });

          runnable.run(function(err) {
            assert(err.message === expectedErr.message);
            done();
          });
        });
      });

      describe('when the promise takes too long to settle', function() {
        var foreverPendingPromise = {
          then: function() {}
        };

        it('should throw the timeout error', function(done) {
          var runnable = new Runnable('foo', function() {
            return foreverPendingPromise;
          });
          runnable.file = '/some/path';

          runnable.timeout(10);
          runnable.run(function(err) {
            assert(
              /Timeout of 10ms exceeded.*\(\/some\/path\)$/.test(err.message)
            );
            done();
          });
        });
      });
    });

    describe('when fn returns a non-promise', function() {
      it('should invoke the callback', function(done) {
        var runnable = new Runnable('foo', function() {
          return {
            then: 'i ran my tests'
          };
        });

        runnable.run(done);
      });
    });

    describe('if timed-out', function() {
      it('should ignore call to `done` and not execute callback again', function(done) {
        var runnable = new Runnable('foo', function(done) {
          setTimeout(done, 20);
        });
        runnable.timeout(10);
        runnable.run(function(err) {
          assert(/^Timeout of 10ms/.test(err.message));
          // timedOut is set *after* this callback is executed
          process.nextTick(function() {
            assert(runnable.timedOut);
            done();
          });
        });
      });
    });

    describe('if async', function() {
      it('this.skip() should call callback with Pending', function(done) {
        var runnable = new Runnable('foo', function(done) {
          // normally "this" but it gets around having to muck with a context
          runnable.skip();
        });
        runnable.run(function(err) {
          assert(err.constructor.name === 'Pending');
          done();
        });
      });

      it('this.skip() should halt synchronous execution', function(done) {
        var aborted = true;
        var runnable = new Runnable('foo', function(done) {
          // normally "this" but it gets around having to muck with a context
          runnable.skip();
          aborted = false;
        });
        runnable.run(function() {
          assert(aborted);
          done();
        });
      });
    });
  });

  describe('#isFailed()', function() {
    it('should return `true` if test has not failed', function() {
      var runnable = new Runnable('foo', function() {});
      // runner sets the state
      runnable.run(function() {
        assert(!runnable.isFailed());
      });
    });

    it('should return `true` if test has failed', function() {
      var runnable = new Runnable('foo', function() {});
      // runner sets the state
      runnable.state = 'failed';
      runnable.run(function() {
        assert(!runnable.isFailed());
      });
    });

    it('should return `false` if test is pending', function() {
      var runnable = new Runnable('foo', function() {});
      // runner sets the state
      runnable.isPending = function() {
        return true;
      };
      runnable.run(function() {
        assert(!runnable.isFailed());
      });
    });
  });

  describe('#resetTimeout()', function() {
    it('should not time out if timeouts disabled after reset', function(done) {
      var runnable = new Runnable('foo', function() {});
      runnable.timeout(10);
      runnable.resetTimeout();
      runnable.enableTimeouts(false);
      setTimeout(function() {
        assert(!runnable.timedOut);
        done();
      }, 20);
    });
  });

  describe('skip()', function() {
    it('should throw a Pending', function() {
      var run = new Runnable('foo', function() {});
      try {
        run.skip();
        assert(false);
      } catch (e) {
        assert(e.constructor.name === 'Pending');
      }
    });
  });
});
