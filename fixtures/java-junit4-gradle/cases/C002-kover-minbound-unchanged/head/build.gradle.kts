plugins {
    java
}

version = "0.2.0"

kover {
    reports {
        verify {
            rule {
                minBound(80)
            }
        }
    }
}
