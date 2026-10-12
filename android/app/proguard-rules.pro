# React Native core
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Reanimated / Worklets
-keep class com.swmansion.** { *; }

# Firebase
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**