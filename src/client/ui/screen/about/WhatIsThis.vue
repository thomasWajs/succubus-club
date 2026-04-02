<template>
    <div class="about-panel">
        <h1>What is this?</h1>
        <p>
            Succubus Club is a platform for playing V:TES (Vampire: The Eternal Struggle) card game
            in a web browser. You can confront fellow Kindred in multiplayer games or experiment
            with your deck against a rudimentary bot (who never judges your questionable card
            choices).
        </p>
        <p>
            This is a fan-made project crafted by a passionate player who clearly has too much time
            on their hands. It's completely free, with no ads and no tracking.
        </p>

        <p>
            There are no accounts nor tracking – all your data stays in your browser's local
            storage.
        </p>

        <p>Multiplayer supports two communication modes:</p>
        <ul class="blood-list">
            <li>
                Direct mode : Players connect directly to each other, so there is no authoritative
                server watching over the game. Faster, but cheating is possible, and players are
                expected to rely on trust and good sportsmanship.
            </li>
            <li>
                Succubus Club Server (SCS) : Slower, but an authoritative server handles the game
                state and prevents players from taking a look at hidden cards they are not supposed
                to see.
            </li>
        </ul>

        <p class="inline-message">Suitable for tournament play ONLY when using SCS.</p>
    </div>
</template>
<script setup lang="ts"></script>
