<template>
    <div class="user-manual">
        <section class="manual-section">
            <h2 class="section-title">Good to Know</h2>
            <div class="info-list">
                <div class="info-item">Logs won't reveal cards to other players</div>
                <div class="info-item">Only you can see your uncontrolled zone</div>
                <div class="info-item">UI features are configurables in the user preferences</div>
            </div>
        </section>

        <section class="manual-section">
            <h2 class="section-title">Mouse Controls</h2>
            <div class="controls-list">
                <div class="control-item">
                    <span class="action">Click on lib/crypt</span>
                    <span class="result">Draw</span>
                </div>
                <div class="control-item">
                    <span class="action">Click on card</span>
                    <span class="result">Select card</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>Ctrl</kbd> + Click on card</span>
                    <span class="result">Add to selection</span>
                </div>
                <div class="control-item">
                    <span class="action">Area select</span>
                    <span class="result">Group selection</span>
                </div>
                <div class="control-item">
                    <span class="action">Drag'n drop</span>
                    <span class="result">Move selection</span>
                </div>
                <div class="control-item">
                    <span class="action">Right click on card</span>
                    <span class="result">Context menu</span>
                </div>
                <div class="control-item">
                    <span class="action">Double click card</span>
                    <span class="result">Lock/Unlock</span>
                </div>
            </div>
        </section>

        <section class="manual-section">
            <h2 class="section-title">Some Keyboard Shortcuts</h2>
            <div class="controls-list">
                <div class="control-item">
                    <span class="action"><kbd>Backspace</kbd></span>
                    <span class="result">Cancel last action</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>→</kbd> / <kbd>Space</kbd></span>
                    <span class="result">Next phase</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>←</kbd></span>
                    <span class="result">Previous phase</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>1</kbd>...<kbd>5</kbd></span>
                    <span class="result">Go to phase</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>Enter</kbd></span>
                    <span class="result">Next turn</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>Z</kbd></span>
                    <span class="result">Zoom card</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>D</kbd></span>
                    <span class="result">Draw lib</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>C</kbd></span>
                    <span class="result">Draw crypt</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>+</kbd></span>
                    <span class="result">Gain blood / life</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>-</kbd></span>
                    <span class="result">Burn blood / life</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>A</kbd></span>
                    <span class="result">Move to Ash Heap</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>T</kbd></span>
                    <span class="result">Declare Target</span>
                </div>
            </div>
        </section>

        <!-- Commented pending camera fixes. See https://github.com/thomasWajs/succubus-club/issues/12 -->
        <!--
        <section class="manual-section">
            <h2 class="section-title">Camera</h2>
            <div class="controls-list">
                <div class="control-item">
                    <span class="action">🖱️ Wheel</span>
                    <span class="result">Zoom in/out</span>
                </div>
                <div class="control-item">
                    <span class="action">🖱️ Middle click + Move</span>
                    <span class="result">Move</span>
                </div>
                <div class="controls-list">
                    <div class="control-item">
                        <span class="action"><kbd>M</kbd></span>
                        <span class="result">Reset Camera</span>
                    </div>
                </div>
            </div>
        </section>
        -->
    </div>
</template>

<script setup lang="ts"></script>

<style lang="scss" scoped>
.user-manual {
    max-width: 500px;
    margin: auto;
}

.manual-section {
    margin-bottom: 0.5rem;
}

// Flat rows, muted gestures, the result as the readable part
.section-title {
    @include ui-title;
    color: var(--ui-panel-text-muted);
    font-size: 1rem;
    margin: 0 0 0.5rem 0;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--ui-border);
}

.controls-list,
.info-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.info-item,
.control-item {
    color: var(--ui-panel-text);
    background: var(--ui-raised-bg);
    padding: 8px 10px;
    font-size: 14px;
}

.info-item {
    background-color: light-dark(rgba($lighter-teal, 0.5), $ui-surface-raised);
}

.info-item::before {
    content: '✓';
    margin-right: 0.25rem;
    color: light-dark($shadow-grey, $ui-accent-light);
}

.control-item {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .action {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        color: var(--ui-panel-text-muted);
    }

    .result {
        font-style: italic;
        font-weight: 600;
        flex: 1;
        text-align: right;
    }
}
</style>
