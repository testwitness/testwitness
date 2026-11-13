plugins {
    java
    id("org.jetbrains.kotlinx.kover") version "0.9.1"
}

kover {
    reports {
        verify {
            rule {
            }
        }
    }
}
