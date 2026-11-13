package com.example;

interface Codec {
  String encode(String value);

  String decode(String encoded);
}
