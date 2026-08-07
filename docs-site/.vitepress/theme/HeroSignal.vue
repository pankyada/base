<template>
  <div class="h-hero-signal" aria-hidden="true">
    <div class="h-hero-glow h-hero-glow--blue" />
    <div class="h-hero-glow h-hero-glow--red" />
    <div class="h-hero-glow h-hero-glow--violet" />
    <svg class="h-hero-pulses" viewBox="0 0 1600 640" preserveAspectRatio="none">
      <path id="h-pulse-path-1" d="M -100 160 L 320 160 L 420 260 L 900 260 L 1000 160 L 1700 160" />
      <path id="h-pulse-path-2" d="M 1700 460 L 1180 460 L 1080 360 L 560 360 L 460 460 L -100 460" />
      <circle class="h-hero-pulse h-hero-pulse--blue" r="3.5">
        <animateMotion dur="9s" repeatCount="indefinite" begin="0s">
          <mpath href="#h-pulse-path-1" />
        </animateMotion>
      </circle>
      <circle class="h-hero-pulse h-hero-pulse--violet" r="3.5">
        <animateMotion dur="11s" repeatCount="indefinite" begin="-4s">
          <mpath href="#h-pulse-path-2" />
        </animateMotion>
      </circle>
    </svg>
  </div>
</template>

<script setup lang="ts"></script>
