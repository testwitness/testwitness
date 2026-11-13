package com.example.listeners;

import java.util.ArrayList;
import java.util.List;

public class RecordingListener {
  private final List<String> events = new ArrayList<>();

  public void onEvent(String event) {
    events.add(event);
  }

  public List<String> events() {
    return events;
  }
}
