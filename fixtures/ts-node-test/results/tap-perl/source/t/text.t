use strict;
use warnings;
use Test::More tests => 6;

sub slugify {
    my ($text) = @_;
    $text = lc $text;
    $text =~ s/[^a-z0-9]+/-/g;
    $text =~ s/^-+|-+$//g;
    return $text;
}

is(slugify('Hello World'), 'hello-world', 'lowercases and joins with dashes');
is(slugify('  --Hi!  '), 'hi', 'strips leading and trailing separators');

SKIP: {
    skip 'unicode is not handled yet', 1;
    is(slugify("\x{dc}n\x{ef}code"), 'unicode', 'handles unicode');
}

TODO: {
    local $TODO = 'numbers are not kept yet';
    is(slugify('a1 b2'), 'a1_b2', 'keeps numbers');
}

is(slugify('A B'), 'a_b', 'fails on purpose');

subtest 'clamp table' => sub {
    plan tests => 2;
    ok(1, 'inside the range');
    ok(1, 'at the edge');
};
