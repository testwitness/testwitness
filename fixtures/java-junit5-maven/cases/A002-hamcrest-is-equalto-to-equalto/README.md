Negative, Hamcrest. is(equalTo(200)) and equalTo(200) are the same matcher; is() only reads better. The outer matcher is unwrapped, so the strength is unchanged and nothing fires.
