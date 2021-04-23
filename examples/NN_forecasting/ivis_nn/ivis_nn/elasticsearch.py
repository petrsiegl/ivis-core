import numpy as np
import pandas as pd

from .common import *


###########
# Queries #
###########


def get_docs_query(parameters):
    """Creates a query for ES to return the docs (in their original form)."""
    signals = parameters["inputSignals"] + parameters["targetSignals"]
    cid_to_field, sig_to_field = get_signal_helpers(parameters)
    ts_field = cid_to_field(parameters["tsSigCid"])

    return {
       'size': 5,  # TODO
       '_source': list(map(sig_to_field, signals)),
       'sort': [{ts_field: 'desc'}],  # TODO: time sort direction
       'query': {  # TODO: add filtering? (time interval)
          "match_all": {}
       }
    }


def get_histogram_query(parameters):
    """Creates a query for ES to return a date histogram aggregation."""
    signals = parameters["inputSignals"] + parameters["targetSignals"]
    cid_to_field, sig_to_field = get_signal_helpers(parameters)
    ts_field = cid_to_field(parameters["tsSigCid"])
    entities_signals = get_entities_signals(parameters)

    signal_aggs = dict()
    for sig in signals:
        field = sig_to_field(sig)
        signal_type = entities_signals[sig["cid"]]["type"]

        if signal_type == 'keyword':
            signal_aggs[field] = {
                "terms": {
                    "field": field,
                    'size': 1
                }
            }
        else:
            signal_aggs[field] = {
                "avg": {  # TODO: min, max? possibly more at the same time (one key in signal_aggs is needed for each agg)
                    "field": field
                }
            }
    # TODO: Is it necessary to add sort? -> possibly for size?

    return {
       "size": 0,
       "aggs": {
           "aggregated_data": {
               "date_histogram": {
                   "field": ts_field,
                   "interval": "3652d",  # 10 years # TODO
                   "offset": "0d",
                   "min_doc_count": 1  # TODO: what to do with missing data?
               },
               "aggs": signal_aggs
           }
       }
    }


###########
# Results #
###########


def _parse_signal_values_from_docs(field, docs):
    """Returns the values of one signal as np array (vector)"""
    values = []
    for d in docs:
        values.append(d["_source"][field])
    return np.array(values)


def _parse_signal_values_from_buckets(field, sig_type, buckets):
    """Returns the values of one signal as np array (vector)"""
    values = []
    for b in buckets:
        if sig_type == 'keyword':
            val = b[field]["buckets"][0]["key"]
        else:
            val = b[field]["value"]

        values.append(val)
    return np.array(values)


def _get_hits(data):
    return data["hits"]["hits"]


def _get_buckets(data):
    return data["aggregations"]["aggregated_data"]["buckets"]


def parse_docs(training_parameters, data):
    """
    Parse the docs data from Elasticsearch.

    Parameters
    ----------
    training_parameters : dict
    data : dict
        JSON response from Elasticsearch parsed to dict

    Returns
    -------
    (pd.DataFrame, pd.DataFrame)
        Dataframe of both inputs and targets. Columns are fields, rows are the training patterns (docs from ES).
    """
    docs = _get_hits(data)
    schema = get_merged_schema(training_parameters)

    dataframe = pd.DataFrame()

    for sig in schema:
        sig_values = _parse_signal_values_from_docs(sig, docs)
        dataframe[sig] = sig_values

    return dataframe


def parse_histogram(training_parameters, data):
    """
    Parse the date histogram data from Elasticsearch.

    Parameters
    ----------
    training_parameters : dict
    data : dict
        JSON response from Elasticsearch parsed to dict

    Returns
    -------
    pd.DataFrame
        Dataframe of both inputs and targets. Columns are fields, rows are the training patterns (buckets from ES).
    """
    buckets = _get_buckets(data)
    schema = get_merged_schema(training_parameters)

    dataframe = pd.DataFrame()

    for sig in schema:
        sig_values = _parse_signal_values_from_buckets(sig, schema[sig]["type"], buckets)  # TODO: more than just avg aggregation
        dataframe[sig] = sig_values

    return dataframe


def parse_data(training_parameters, data):
    if training_parameters["query_type"] == "docs":
        return parse_docs(training_parameters, data)
    elif training_parameters["query_type"] == "histogram":
        return parse_histogram(training_parameters, data)
    else:
        raise Exception("Unknown query type")