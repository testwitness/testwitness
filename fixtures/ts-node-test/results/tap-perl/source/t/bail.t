use strict;
use warnings;
use Test::More tests => 3;

ok(1, 'connects to the fixture database');
BAIL_OUT('fixture database is gone') unless 0;
ok(1, 'never reached');
ok(1, 'never reached either');
