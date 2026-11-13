plugins {
    java
}

kover {
    reports {
        verify {
            rule {
                minBound(80)
            }
        }
    }
}
