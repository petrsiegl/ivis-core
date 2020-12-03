'use strict';

import React, {Component} from "react";
import * as d3Axis from "d3-axis";
import * as d3Scale from "d3-scale";
import {event as d3Event, select} from "d3-selection";
import * as d3Brush from "d3-brush";
import {intervalAccessMixin} from "./TimeContext";
import {DataAccessSession} from "./DataAccess";
import {withAsyncErrorHandler, withErrorHandling} from "../lib/error-handling";
import interoperableErrors from "../../../shared/interoperable-errors";
import PropTypes from "prop-types";
import {IntervalSpec} from "./TimeInterval";
import {Tooltip} from "./Tooltip";
import tooltipStyles from "./Tooltip.scss";
import * as dateMath from "../lib/datemath";
import {Icon} from "../lib/bootstrap-components";
import {withComponentMixins} from "../lib/decorator-helpers";
import {withTranslation} from "../lib/i18n";
import {areZoomTransformsEqual, ConfigDifference, setZoomTransform, transitionInterpolate, wheelDelta} from "./common";
import * as d3Zoom from "d3-zoom";
import commonStyles from "./commons.scss";
import timeBasedChartBaseStyles from "./TimeBasedChartBase.scss";

export function createBase(base, self) {
    self.base = base;
    return self;
}

export function isSignalVisible(sigConf) {
    return ('label' in sigConf) && (!('enabled' in sigConf) || sigConf.enabled);
}

class TooltipContent extends Component {
    constructor(props) {
        super(props);
    }

    static propTypes = {
        config: PropTypes.array.isRequired,
        signalSetsData: PropTypes.object,
        selection: PropTypes.object,
        getSignalValues: PropTypes.func.isRequired
    }

    render() {
        if (this.props.selection) {
            const rows = [];
            let ts;

            let sigSetIdx = 0;
            for (const sigSetConf of this.props.config) {
                const sel = this.props.selection[sigSetConf.cid];
                const isAgg = this.props.signalSetsData[sigSetConf.cid].isAggregated;

                if (sel) {
                    ts = sel.ts;
                    let sigIdx = 0;
                    for (const sigConf of sigSetConf.signals) {
                        if (isSignalVisible(sigConf)) {
                            const sigVals = this.props.getSignalValues(this, sigSetConf, sigConf, sigSetConf.cid, sigConf.cid, sel.data[sigConf.cid], isAgg);

                            if (sigVals) {
                                rows.push(
                                    <div key={`${sigSetIdx} ${sigIdx}`}>
                                        <span className={tooltipStyles.signalColor} style={{color: sigConf.color}}><Icon
                                            icon="minus"/></span>
                                        <span className={tooltipStyles.signalLabel}>{sigConf.label}:</span>
                                        {this.props.getSignalValues(this, sigSetConf, sigConf, sigSetConf.cid, sigConf.cid, sel.data[sigConf.cid], isAgg)}
                                    </div>
                                );
                            }
                        }

                        sigIdx += 1;
                    }
                }

                sigSetIdx += 1;
            }

            return (
                <div>
                    <div className={tooltipStyles.time}>{dateMath.format(ts)}</div>
                    {rows}
                </div>
            );

        } else {
            return null;
        }
    }
}

export const RenderStatus = {
    SUCCESS: 0,
    NO_DATA: 1
};

export {ConfigDifference} from "./common";

function compareConfigs(conf1, conf2, customComparator) {
    let diffResult = ConfigDifference.NONE;

    function compareColor(a, b) {
        return a.r === b.r && a.g === b.g && a.b === b.b && a.opacity === b.opacity;
    }

    function compareSignal(sig1, sig2) {
        if (sig1.cid !== sig2.cid || sig1.mutate !== sig2.mutate || sig1.generate !== sig2.generate) {
            diffResult = ConfigDifference.DATA;
        } else if (!compareColor(sig1.color, sig2.color) || sig1.label !== sig2.label || sig1.enabled !== sig2.enabled) {
            diffResult = ConfigDifference.RENDER;
        }
    }


    function compareSigSet(sigSet1, sigSet2) {
        if (sigSet1.cid !== sigSet2.cid) {
            diffResult = ConfigDifference.DATA;
            return;
        }

        if (sigSet1.signals.length !== sigSet2.signals.length) {
            diffResult = ConfigDifference.DATA;
            return;
        }

        for (let idx = 0; idx < sigSet1.signals.length; idx++) {
            compareSignal(sigSet1.signals[idx], sigSet2.signals[idx]);
            if (diffResult === ConfigDifference.DATA) {
                return;
            }
        }
    }

    function compareConf(conf1, conf2) {
        if (conf1.signalSets.length !== conf2.signalSets.length) {
            diffResult = ConfigDifference.DATA;
            return;
        }

        for (let idx = 0; idx < conf1.signalSets.length; idx++) {
            compareSigSet(conf1.signalSets[idx], conf2.signalSets[idx]);
            if (diffResult === ConfigDifference.DATA) {
                return;
            }
        }

        if (customComparator) {
            const res = customComparator(conf1, conf2);
            if (res > diffResult) {
                diffResult = res;
            }
        }
    }

    compareConf(conf1, conf2);
    return diffResult;
}


@withComponentMixins([
    withTranslation,
    withErrorHandling,
    intervalAccessMixin()
])
export class TimeBasedChartBase extends Component {
    constructor(props) {
        super(props);

        const t = props.t;

        this.dataAccessSession = new DataAccessSession();
        this.state = {
            selection: null,
            mousePosition: null,
            signalSetsData: null,
            statusMsg: t('Loading...'),
            width: 0,
            zoomTransform: d3Zoom.zoomIdentity,
            loading: true
        };
        this.zoom = null;

        this.resizeListener = () => {
            this.createChart(this.state.signalSetsData);
            this.updateTimeIntervalChartWidth();
        };

        this.delayedFetchDueToTimeIntervalChartWidthUpdate = false;
    }

    static propTypes = {
        config: PropTypes.object.isRequired,
        contentComponent: PropTypes.func,
        contentRender: PropTypes.func,
        height: PropTypes.number.isRequired,
        margin: PropTypes.object.isRequired,
        withBrush: PropTypes.bool,
        withTooltip: PropTypes.bool,
        withZoom: PropTypes.bool,
        zoomUpdateReloadInterval: PropTypes.number, // milliseconds after the zoom ends; set to null to disable updates
        tooltipContentComponent: PropTypes.func,
        tooltipContentRender: PropTypes.func,

        getSignalValuesForDefaultTooltip: PropTypes.func,
        getQueries: PropTypes.func.isRequired,
        prepareData: PropTypes.func.isRequired,
        createChart: PropTypes.func.isRequired,
        getGraphContent: PropTypes.func.isRequired,
        getSvgDefs: PropTypes.func,
        compareConfigs: PropTypes.func,

        tooltipExtraProps: PropTypes.object,

        minimumIntervalMs: PropTypes.number,

        controlTimeIntervalChartWidth: PropTypes.bool
    }

    static defaultProps = {
        tooltipExtraProps: {},
        minimumIntervalMs: 10000,
        getSvgDefs: () => null,
        zoomUpdateReloadInterval: 1000
    }

    updateTimeIntervalChartWidth() {
        const intv = this.getInterval();
        const width = this.containerNode.getClientRects()[0].width;

        if (this.props.controlTimeIntervalChartWidth && intv.conf.chartWidth !== width) {
            intv.setConf({
                chartWidth: width
            });

            this.delayedFetchDueToTimeIntervalChartWidthUpdate = true;
        }
    }

    componentDidMount() {
        window.addEventListener('resize', this.resizeListener);

        // This causes the absolute interval to change, which in turn causes a data fetch
        this.updateTimeIntervalChartWidth();

        if (!this.delayedFetchDueToTimeIntervalChartWidthUpdate) {
            this.fetchData();
        }

        // this.createChart(this.state.signalSetsData) is not needed here because at this point, we are missing too many things to actually execute it
    }

    componentDidUpdate(prevProps, prevState) {
        let signalSetsData = this.state.signalSetsData;

        const t = this.props.t;

        const configDiff = compareConfigs(prevProps.config, this.props.config, this.props.compareConfigs);

        const prevAbs = this.getIntervalAbsolute(prevProps);
        const prevSpec = this.getIntervalSpec(prevProps);
        if (configDiff === ConfigDifference.DATA) {
            this.setState({
                signalSetsData: null
            });
            this.zoom = null;

            this.fetchData();

            signalSetsData = null;

        } else if (prevSpec !== this.getIntervalSpec()) {
            this.zoom = null;
            this.fetchData();
        } else if (this.delayedFetchDueToTimeIntervalChartWidthUpdate || prevAbs !== this.getIntervalAbsolute()) { // If its just a regular refresh, don't clear the chart
            this.delayedFetchDueToTimeIntervalChartWidthUpdate = false;

            if (!areZoomTransformsEqual(this.state.zoomTransform, d3Zoom.zoomIdentity)) // update time interval based on what is currently visible
                this.setInterval(...this.xScaleDomain);

            this.fetchData();

        } else {
            const forceRefresh = this.prevContainerNode !== this.containerNode
                || prevState.signalSetsData !== this.state.signalSetsData
                || configDiff !== ConfigDifference.NONE
                || this.getIntervalAbsolute(prevProps) !== this.getIntervalAbsolute()
                || !areZoomTransformsEqual(prevState.zoomTransform, this.state.zoomTransform);

            this.createChart(signalSetsData, forceRefresh);
            this.prevContainerNode = this.containerNode;
        }
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.resizeListener);
        clearTimeout(this.zoomUpdateReloadTimeoutID);
    }

    @withAsyncErrorHandler
    async fetchData() {
        const t = this.props.t;
        this.setState({statusMsg: t('Loading...'), loading: true});

        try {
            const queries = this.props.getQueries(this, this.getIntervalAbsolute(), this.props.config);

            const results = await this.dataAccessSession.getLatestMixed(queries);

            if (results) {
                // This converts NaNs and Infinity to null. D3 can handle nulls in data by omitting the data point
                for (const resultSet of results) {
                    for (const sigSetCid in resultSet) {
                        const sigSetData = resultSet[sigSetCid];

                        const processSignals = data => {
                            for (const sigCid in data) {
                                const sigData = data[sigCid];
                                for (const agg in sigData) {
                                    if (!isFinite(sigData[agg])) {
                                        sigData[agg] = null;
                                    }
                                }
                            }
                        };

                        if (sigSetData.prev) {
                            processSignals(sigSetData.prev.data);
                        }

                        if (sigSetData.main) {
                            for (const mainData of sigSetData.main) {
                                processSignals(mainData.data);
                            }
                        }

                        if (sigSetData.next) {
                            processSignals(sigSetData.next.data);
                        }
                    }
                }

                this.setState({signalSetsData: null}, () =>
                    this.setState({
                        statusMsg: "",
                        ...this.props.prepareData(this, results),
                        loading: false
                    })
                );
            }
        } catch (err) {
            if (err instanceof interoperableErrors.TooManyPointsError) {
                this.setState({
                    statusMsg: t('Too many data points.')
                });
                return;
            }

            throw err;
        } finally {
            this.setState({loading: false});
        }
    }

    createChart(signalSetsData, forceRefresh) {
        const t = this.props.t;
        const self = this;

        const width = this.containerNode.getClientRects()[0].width;

        if (this.state.width !== width) {
            this.setState({
                width
            });
        }

        if (!forceRefresh && width === this.renderedWidth) {
            return;
        }
        this.renderedWidth = width;

        if (!signalSetsData) {
            return;
        }

        const abs = this.getIntervalAbsolute();

        const xScale = this.state.zoomTransform.rescaleX(
            d3Scale.scaleTime()
                .domain([abs.from, abs.to])
                .range([0, width - this.props.margin.left - this.props.margin.right])
        );
        this.xScaleDomain = xScale.domain().map(d => d.valueOf());

        const xAxis = d3Axis.axisBottom(xScale)
            .tickSizeOuter(0);

        this.xAxisSelection
            .call(xAxis);


        if (this.props.withBrush) {
            const brush = d3Brush.brushX()
                .extent([[0, 0], [width - this.props.margin.left - this.props.margin.right, this.props.height - this.props.margin.top - this.props.margin.bottom]])
                .filter(() => { // TODO what to do when withZoom == false
                    // noinspection JSUnresolvedVariable
                    return d3Event.ctrlKey && !d3Event.button; // enable brush only when ctrl is pressed, modified version of default brush filter (https://github.com/d3/d3-brush#brush_filter)
                })
                .on("end", function brushed() {
                    const sel = d3Event.selection;

                    if (sel) {
                        const selFrom = xScale.invert(sel[0]).valueOf();
                        let selTo = xScale.invert(sel[1]).valueOf();

                        self.setInterval(selFrom, selTo);

                        self.brushSelection.call(brush.move, null);
                    }
                });

            this.brushSelection
                .call(brush);

        } else {
            this.brushSelection
                .selectAll('rect')
                .remove();

            this.brushSelection.append('rect')
                .attr('pointer-events', 'all')
                .attr('cursor', 'crosshair')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', width - this.props.margin.left - this.props.margin.right)
                .attr('height', this.props.height - this.props.margin.top - this.props.margin.bottom)
                .attr('visibility', 'hidden');
        }

        if (this.props.withZoom)
            this.createChartZoom();

        this.cursorLineVisible = false;
        this.cursorSelection
            .attr('y1', this.props.margin.top)
            .attr('y2', this.props.height - this.props.margin.bottom);


        const renderStatus = this.props.createChart(this, signalSetsData, this.state, abs, xScale);

        if (renderStatus === RenderStatus.NO_DATA && this.state.statusMsg === "")
            this.setState({statusMsg: t('No data.')});
    }

    setInterval(from, to) {
        const intv = this.getInterval();

        if (to - from < this.props.minimumIntervalMs) {
            to = from + this.props.minimumIntervalMs;
        }

        const rounded = intv.roundToMinAggregationInterval(from, to);

        const spec = new IntervalSpec(
            rounded.from,
            rounded.to,
            null
        );

        intv.setSpec(spec);
    }

    createChartZoom() {
        const self = this;

        const handleZoom = function () {
            // noinspection JSUnresolvedVariable
            if (d3Event.sourceEvent && d3Event.sourceEvent.type === "wheel") {
                transitionInterpolate(self.containerNodeSelection, self.state.zoomTransform, d3Event.transform, setZoomTransform(self));
            } else {
                // noinspection JSUnresolvedVariable
                self.setState({zoomTransform: d3Event.transform});
            }
        };

        const handleZoomStart = function () {
            clearTimeout(self.zoomUpdateReloadTimeoutID);
        };

        const handleZoomEnd = function () {
            // noinspection JSUnresolvedVariable
            if (self.props.zoomUpdateReloadInterval === null || self.props.zoomUpdateReloadInterval === undefined) // don't update automatically
                return;
            // noinspection JSUnresolvedVariable
            if (!Object.is(d3Event.transform, d3Zoom.zoomIdentity))
                if (self.props.zoomUpdateReloadInterval > 0) {
                    clearTimeout(self.zoomUpdateReloadTimeoutID);
                    self.zoomUpdateReloadTimeoutID = setTimeout(() => {
                        self.setInterval(...self.xScaleDomain)
                    }, self.props.zoomUpdateReloadInterval);
                } else if (self.props.zoomUpdateReloadInterval >= 0)
                    self.setInterval(...self.xScaleDomain);
        };

        const ySize = this.props.height - this.props.margin.top - this.props.margin.bottom;
        const zoomExtent = [[0, 0], [this.renderedWidth - this.props.margin.left - this.props.margin.right, ySize]];
        const translateExtent = [[-Infinity, 0], [Infinity, this.props.height - this.props.margin.top - this.props.margin.bottom]];
        const zoomExisted = this.zoom !== null;
        this.zoom = zoomExisted ? this.zoom : d3Zoom.zoom();
        this.zoom
            .translateExtent(translateExtent)
            .extent(zoomExtent)
            .on("zoom", handleZoom)
            .on("end", handleZoomEnd)
            .on("start", handleZoomStart)
            .wheelDelta(wheelDelta(3))
            .filter(() => {
                if (d3Event.type === "wheel" && !d3Event.shiftKey)
                    return false;
                return !d3Event.ctrlKey && !d3Event.button;
            });
        this.containerNodeSelection.call(this.zoom);
        if (!zoomExisted)
            this.resetZoom(); // this is called after data are reloaded
    }

    setZoom(transform) {
        if (this.props.withZoom && this.zoom)
            this.containerNodeSelection.call(this.zoom.transform, transform);
        else
            this.setState({zoomTransform: transform})
    }

    resetZoom() {
        this.setZoom(d3Zoom.zoomIdentity);
    }

    render() {
        const config = this.props.config;

        if (!this.state.signalSetsData) {
            return (
                <svg ref={node => this.containerNode = node} height={this.props.height} width="100%">
                    <text textAnchor="middle" x="50%" y="50%"
                          fontFamily="'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif" fontSize="14px"
                          fill="currentColor">
                        {this.state.statusMsg}
                    </text>
                </svg>
            );

        } else {

            let content = null;
            const contentProps = {
                selection: this.state.selection,
                mousePosition: this.state.mousePosition,
                containerHeight: this.props.height,
                containerWidth: this.state.width
            };
            if (this.props.contentComponent) {
                content = <this.props.contentComponent {...contentProps}/>;
            } else if (this.props.contentRender) {
                content = this.props.contentRender(contentProps);
            }

            const tooltipExtraProps = {...this.props.tooltipExtraProps};

            if (this.props.tooltipContentComponent) {
                tooltipExtraProps.contentComponent = tooltipContentComponent;
            } else if (this.props.contentRender) {
                tooltipExtraProps.contentRender = tooltipContentRender;
            } else {
                tooltipExtraProps.contentRender = (props) => <TooltipContent
                    getSignalValues={this.props.getSignalValuesForDefaultTooltip} {...props}/>;
            }


            return (
                <svg id="cnt" ref={node => {
                    this.containerNode = node;
                    this.containerNodeSelection = select(node)
                }} height={this.props.height} width="100%">
                    {this.props.getSvgDefs(this)}
                    <defs>
                        <clipPath id="plotRect">
                            <rect x="0" y="0"
                                  width={this.state.width - this.props.margin.left - this.props.margin.right}
                                  height={this.props.height - this.props.margin.top - this.props.margin.bottom}/>
                        </clipPath>
                    </defs>
                    <g transform={`translate(${this.props.margin.left}, ${this.props.margin.top})`}
                       clipPath="url(#plotRect)" ref={node => this.GraphContentSelection = select(node)}>
                        {(!areZoomTransformsEqual(this.state.zoomTransform, d3Zoom.zoomIdentity) || this.state.loading) &&
                        <rect className={timeBasedChartBaseStyles.loadingOverlay}/>}
                        {this.props.getGraphContent(this)}
                    </g>
                    <g ref={node => this.xAxisSelection = select(node)}
                       transform={`translate(${this.props.margin.left}, ${this.props.height - this.props.margin.bottom})`}/>
                    <g ref={node => this.yAxisSelection = select(node)}
                       transform={`translate(${this.props.margin.left}, ${this.props.margin.top})`}/>
                    <line ref={node => this.cursorSelection = select(node)} className={commonStyles.cursorLine}
                          visibility="hidden"/>
                    <text textAnchor="middle" x="50%" y="50%"
                          fontFamily="'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif" fontSize="14px"
                          fill="currentColor">
                        {this.state.statusMsg}
                    </text>
                    {this.props.withTooltip &&
                    <Tooltip
                        config={this.props.config.signalSets}
                        signalSetsData={this.state.signalSetsData}
                        containerHeight={this.props.height}
                        containerWidth={this.state.width}
                        mousePosition={this.state.mousePosition}
                        selection={this.state.selection}
                        {...tooltipExtraProps}
                    />
                    }
                    {content}
                    <g ref={node => this.brushSelection = select(node)}
                       transform={`translate(${this.props.margin.left}, ${this.props.margin.top})`}/>
                </svg>
            );
        }
    }
}
